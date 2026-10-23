import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const CREDITS_CHANGED = "credits-changed";
const CACHE_KEY = "latest-summary";

const moneySchema = z.object({
  currencyCode: z.string(),
  currencyAmount: z.string(),
});

const rawCreditSchema = z.object({
  creditId: z.string(),
  description: z.string(),
  creditStatus: z.string(),
  initialAmount: moneySchema.optional(),
  remainingAmount: moneySchema.optional(),
  estimatedAmount: moneySchema.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const rawCreditsResponseSchema = z.object({
  credits: z.array(rawCreditSchema),
});

const rawAllocationSchema = z.object({
  creditAmount: moneySchema,
  appliedServiceName: z.string(),
  billingMonth: z.string(),
  isEstimatedBill: z.boolean(),
});

const rawAllocationResponseSchema = z.object({
  creditAllocationHistoryList: z.array(rawAllocationSchema),
  partialResults: z.boolean().optional(),
  failedMonths: z.array(z.string()).optional(),
});

const callerIdentitySchema = z.object({
  Account: z.string().regex(/^\d{12}$/),
});

const creditSchema = z.object({
  id: z.string(),
  description: z.string(),
  initial: z.number(),
  remaining: z.number(),
  estimated: z.number(),
  startsAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  status: z.string(),
  isActivate: z.boolean(),
});
export type AwsCredit = z.infer<typeof creditSchema>;

const serviceUsageSchema = z.object({
  service: z.string(),
  amount: z.number(),
});

export const summarySchema = z.object({
  accountId: z.string(),
  profile: z.string(),
  currency: z.string(),
  initial: z.number(),
  remaining: z.number(),
  estimated: z.number(),
  used: z.number(),
  usedPercent: z.number(),
  monthUsed: z.number(),
  month: z.string(),
  allocationIsEstimated: z.boolean(),
  serviceUsage: z.array(serviceUsageSchema),
  credits: z.array(creditSchema),
  primaryCreditId: z.string().nullable(),
  fetchedAt: z.string(),
  stale: z.boolean(),
  warning: z.string().nullable(),
});
export type AwsCreditsSummary = z.infer<typeof summarySchema>;

export const rpcContract = defineRpcContract({
  credits_summary: {
    input: z.object({ force: z.boolean().default(false) }),
    output: summarySchema,
  },
  aws_login: {
    input: z.null(),
    output: z.object({ started: z.boolean(), message: z.string() }),
  },
});

function amount(value: z.infer<typeof moneySchema> | undefined): number {
  if (value === undefined) return 0;
  const parsed = Number(value.currencyAmount);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function friendlyAwsError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const lower = raw.toLowerCase();
  if (
    lower.includes("expired") ||
    lower.includes("unable to locate credentials") ||
    lower.includes("could not load credentials") ||
    lower.includes("security token")
  ) {
    return "AWS session expired. Reconnect AWS, confirm the official login in your browser, then refresh.";
  }
  if (lower.includes("accessdenied") || lower.includes("not authorized")) {
    return "AWS connected, but this profile cannot read Billing credits. It needs billing:GetCredits, billing:GetCreditAllocationHistory, and aws-portal:ViewBilling.";
  }
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "AWS request failed.";
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    accountId: {
      type: "string",
      label: "AWS account ID",
      description: "Optional. Leave blank to use the account returned by aws sts get-caller-identity.",
      default: "",
      experimental_schema: z.string().trim().refine(
        (value) => value === "" || /^\d{12}$/.test(value),
        "Use a 12-digit AWS account ID or leave this blank",
      ),
    },
    profile: {
      type: "string",
      label: "AWS CLI profile",
      description: "Uses the existing local AWS profile. No access keys are stored in BB.",
      default: "default",
      experimental_schema: z.string().trim().min(1),
    },
    awsCliPath: {
      type: "string",
      label: "AWS CLI path",
      description: "Command or full path for AWS CLI v2.",
      default: "aws",
    },
    loginHelperPath: {
      type: "string",
      label: "Custom AWS reconnect helper",
      description: "Optional executable path. Leave blank to run aws sso login with the configured profile.",
      default: "",
    },
    cacheMinutes: {
      type: "number",
      label: "Refresh interval (minutes)",
      description: "AWS credit estimates update daily. BB reuses the last successful result inside this window.",
      default: 360,
      experimental_schema: z.number().min(15).max(1440),
    },
  });

  let config = await settings.get();
  settings.onChange((next) => {
    config = next;
  });

  async function awsJson(args: string[]): Promise<unknown> {
    const profileArgs = config.profile.trim() === "" ? [] : ["--profile", config.profile.trim()];
    const { stdout } = await execFileAsync(
      config.awsCliPath,
      [...args, ...profileArgs, "--region", "us-east-1", "--output", "json", "--no-cli-pager"],
      {
        timeout: 45_000,
        maxBuffer: 24 * 1024 * 1024,
        env: { ...process.env, AWS_PAGER: "", NO_COLOR: "1" },
      },
    );
    return JSON.parse(stdout);
  }

  async function resolveAccountId(): Promise<string> {
    const configured = config.accountId.trim();
    if (configured !== "") return configured;
    const identity = callerIdentitySchema.parse(
      await awsJson(["sts", "get-caller-identity"]),
    );
    return identity.Account;
  }

  async function fetchFreshSummary(): Promise<AwsCreditsSummary> {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const month = isoDate(monthStart).slice(0, 7);
    const accountId = await resolveAccountId();

    const rawCredits = rawCreditsResponseSchema.parse(
      await awsJson([
        "billing",
        "get-credits",
        "--account-id",
        accountId,
        "--start-date",
        oneYearAgo.toISOString(),
      ]),
    );

    const credits = rawCredits.credits
      .filter((credit) => credit.creditStatus === "ENABLED")
      .map<AwsCredit>((credit) => ({
        id: credit.creditId,
        description: credit.description,
        initial: amount(credit.initialAmount),
        remaining: amount(credit.remainingAmount),
        estimated: amount(credit.estimatedAmount),
        startsAt: credit.startDate ?? null,
        expiresAt: credit.endDate ?? null,
        status: credit.creditStatus,
        isActivate: credit.description.toLowerCase().includes("aws activate"),
      }))
      .sort((left, right) => {
        if (left.isActivate !== right.isActivate) return left.isActivate ? -1 : 1;
        return right.estimated - left.estimated;
      });

    if (credits.length === 0) {
      throw new Error("AWS returned no enabled promotional credits for this account.");
    }

    let allocations: z.infer<typeof rawAllocationResponseSchema> = {
      creditAllocationHistoryList: [],
    };
    let allocationWarning: string | null = null;
    try {
      allocations = rawAllocationResponseSchema.parse(
        await awsJson([
          "billing",
          "get-credit-allocation-history",
          "--account-id",
          accountId,
          "--start-date",
          monthStart.toISOString(),
          "--end-date",
          now.toISOString(),
        ]),
      );
      if (allocations.partialResults === true) {
        allocationWarning = `AWS returned partial allocation history${
          allocations.failedMonths?.length ? ` for ${allocations.failedMonths.join(", ")}` : ""
        }.`;
      }
    } catch (cause) {
      allocationWarning = `Credit balance loaded, but the monthly breakdown is unavailable: ${friendlyAwsError(cause)}`;
    }

    const serviceTotals = new Map<string, number>();
    let monthUsed = 0;
    let allocationIsEstimated = false;
    for (const allocation of allocations.creditAllocationHistoryList) {
      const applied = Math.abs(amount(allocation.creditAmount));
      monthUsed += applied;
      allocationIsEstimated ||= allocation.isEstimatedBill;
      serviceTotals.set(
        allocation.appliedServiceName,
        (serviceTotals.get(allocation.appliedServiceName) ?? 0) + applied,
      );
    }

    const initial = credits.reduce((total, credit) => total + credit.initial, 0);
    const remaining = credits.reduce((total, credit) => total + credit.remaining, 0);
    const estimated = credits.reduce((total, credit) => total + credit.estimated, 0);
    const used = Math.max(0, initial - estimated);
    const primary = credits.find((credit) => credit.isActivate) ?? credits[0] ?? null;

    const summary: AwsCreditsSummary = {
      accountId,
      profile: config.profile,
      currency: "USD",
      initial,
      remaining,
      estimated,
      used,
      usedPercent: initial > 0 ? (used / initial) * 100 : 0,
      monthUsed,
      month,
      allocationIsEstimated,
      serviceUsage: [...serviceTotals.entries()]
        .map(([service, serviceAmount]) => ({ service, amount: serviceAmount }))
        .sort((left, right) => right.amount - left.amount)
        .slice(0, 8),
      credits,
      primaryCreditId: primary?.id ?? null,
      fetchedAt: now.toISOString(),
      stale: false,
      warning: allocationWarning,
    };

    await bb.storage.kv.set(CACHE_KEY, summary);
    bb.realtime.publish(CREDITS_CHANGED, { fetchedAt: summary.fetchedAt });
    return summary;
  }

  async function getSummary(force: boolean): Promise<AwsCreditsSummary> {
    const cachedRaw = await bb.storage.kv.get<unknown>(CACHE_KEY);
    const cachedResult = summarySchema.safeParse(cachedRaw);
    const cached = cachedResult.success ? cachedResult.data : null;
    const maxAgeMs = Math.max(15, config.cacheMinutes) * 60_000;
    if (
      !force &&
      cached !== null &&
      Date.now() - new Date(cached.fetchedAt).getTime() < maxAgeMs
    ) {
      return cached;
    }
    try {
      return await fetchFreshSummary();
    } catch (cause) {
      const warning = friendlyAwsError(cause);
      bb.log.warn(warning);
      if (cached !== null) {
        return { ...cached, stale: true, warning };
      }
      throw new Error(warning);
    }
  }

  function startLogin(): { started: boolean; message: string } {
    try {
      const customHelper = config.loginHelperPath.trim();
      const profile = config.profile.trim();
      const command = customHelper === "" ? config.awsCliPath : customHelper;
      const args = customHelper === ""
        ? ["sso", "login", ...(profile === "" ? [] : ["--profile", profile])]
        : [];
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          AWS_PROFILE: config.profile,
          AWS_REGION: "us-east-1",
        },
      });
      child.on("error", (cause) => {
        bb.log.warn(`Could not start AWS login: ${friendlyAwsError(cause)}`);
      });
      child.unref();
      return {
        started: true,
        message: customHelper === ""
          ? "AWS SSO login started. Confirm it in the browser, then press Refresh."
          : "AWS reconnect helper started. Finish its login, then press Refresh.",
      };
    } catch (cause) {
      return { started: false, message: friendlyAwsError(cause) };
    }
  }

  bb.rpc.register(rpcContract, {
    credits_summary: ({ force }) => getSummary(force),
    aws_login: async () => startLogin(),
  });

  const usage = [
    "Usage:",
    "  bb aws-activate-usage summary [--json]",
    "  bb aws-activate-usage refresh [--json]",
    "  bb aws-activate-usage login",
  ].join("\n");

  function summaryText(summary: AwsCreditsSummary): string {
    const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
    const primary = summary.credits.find((credit) => credit.id === summary.primaryCreditId);
    return [
      `Estimated AWS credits: ${usd.format(summary.estimated)}`,
      `Used: ${usd.format(summary.used)} of ${usd.format(summary.initial)}`,
      `This month: ${usd.format(summary.monthUsed)}${summary.allocationIsEstimated ? " (estimated)" : ""}`,
      primary?.expiresAt ? `Primary Activate credit expires: ${primary.expiresAt}` : null,
      summary.stale ? `Warning: ${summary.warning ?? "Showing cached data."}` : null,
      `Updated: ${summary.fetchedAt}`,
    ].filter(Boolean).join("\n");
  }

  bb.cli.register({
    name: "aws-activate-usage",
    summary: "Show AWS Activate credit balance and usage",
    commands: [
      { name: "summary", summary: "Show the cached or current credit summary", usage: "bb aws-activate-usage summary [--json]" },
      { name: "refresh", summary: "Fetch fresh credit data from AWS", usage: "bb aws-activate-usage refresh [--json]" },
      { name: "login", summary: "Open the official AWS reconnect flow", usage: "bb aws-activate-usage login" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const command = argv.find((arg) => arg !== "--json");
      if (command === undefined || command === "help" || command === "--help") {
        return { exitCode: 0, stdout: usage };
      }
      if (command === "summary" || command === "refresh") {
        const summary = await getSummary(command === "refresh");
        return {
          exitCode: 0,
          stdout: json ? JSON.stringify(summary) : summaryText(summary),
        };
      }
      if (command === "login") {
        const result = startLogin();
        return {
          exitCode: result.started ? 0 : 1,
          stdout: result.started ? result.message : undefined,
          stderr: result.started ? undefined : result.message,
        };
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
