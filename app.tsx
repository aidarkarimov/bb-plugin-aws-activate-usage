import { useCallback, useEffect, useMemo, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { AwsCreditsSummary, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatDate(value: string | null): string {
  if (value === null) return "No expiration date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatUpdated(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function readableService(value: string): string {
  const names: Record<string, string> = {
    AmazonS3: "Amazon S3",
    AmazonECS: "Amazon ECS",
    AmazonEC2: "Amazon EC2",
    AmazonECR: "Amazon ECR",
    AmazonVPC: "Amazon VPC",
    AmazonKinesis: "Amazon Kinesis",
    AWSLambda: "AWS Lambda",
    AWSAppRunner: "AWS App Runner",
    AWSCostExplorer: "AWS Cost Explorer",
    AWSSecretsManager: "AWS Secrets Manager",
    CodeBuild: "AWS CodeBuild",
    AWSELB: "Elastic Load Balancing",
    awskms: "AWS KMS",
  };
  if (names[value] !== undefined) return names[value];
  if (/^[a-z0-9]{20,}$/i.test(value)) return `AWS/Marketplace ${value.slice(0, 6)}…`;
  return value;
}

function maskedAccount(value: string): string {
  if (value.length < 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function useCredits() {
  const rpc = useRpc<typeof rpcContract>();
  const [summary, setSummary] = useState<AwsCreditsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await rpc.call("credits_summary", { force });
      setSummary(result);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  const reconnect = useCallback(async () => {
    try {
      const result = await rpc.call("aws_login");
      setMessage(result.message);
      if (!result.started) setError(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc]);

  useEffect(() => {
    void load(false);
  }, [load]);
  useRealtime("credits-changed", () => void load(false));

  return { summary, error, loading, message, load, reconnect };
}

function ProgressBar({ usedPercent }: { usedPercent: number }) {
  const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label="AWS credits remaining"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(remainingPercent)}
    >
      <div
        className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
        style={{ width: `${remainingPercent}%` }}
      />
    </div>
  );
}

function LoadingBox() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
      <Icon name="LoaderCircle" className="size-4 animate-spin" />
      Reading AWS Billing…
    </div>
  );
}

function Warning({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
      {children}
    </div>
  );
}

function ErrorBox({ error, onReconnect }: { error: string; onReconnect: () => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex gap-2 text-sm text-destructive">
        <Icon name="TriangleAlert" className="mt-0.5 size-4 shrink-0" />
        <span>{error}</span>
      </div>
      <Button size="sm" variant="outline" onClick={onReconnect}>
        <Icon name="LogIn" className="size-4" />
        Reconnect AWS
      </Button>
    </div>
  );
}

function BalanceSummary({ summary, compact = false }: { summary: AwsCreditsSummary; compact?: boolean }) {
  const primary = useMemo(
    () => summary.credits.find((credit) => credit.id === summary.primaryCreditId) ?? null,
    [summary],
  );
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Estimated AWS credits
        </p>
        <p className={compact ? "mt-1 text-2xl font-semibold tabular-nums" : "mt-1 text-4xl font-semibold tabular-nums"}>
          {usd.format(summary.estimated)}
        </p>
      </div>
      <ProgressBar usedPercent={summary.usedPercent} />
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Used</p>
          <p className="font-medium tabular-nums">{usd.format(summary.used)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Initial total</p>
          <p className="font-medium tabular-nums">{usd.format(summary.initial)}</p>
        </div>
      </div>
      {primary?.expiresAt ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="CalendarClock" className="size-3.5" />
          Main Activate credit expires {formatDate(primary.expiresAt)}
        </p>
      ) : null}
    </div>
  );
}

function ActionRow({
  loading,
  onRefresh,
  onReconnect,
}: {
  loading: boolean;
  onRefresh: () => void;
  onReconnect: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={onRefresh} disabled={loading}>
        <Icon name={loading ? "LoaderCircle" : "RefreshCw"} className={loading ? "size-4 animate-spin" : "size-4"} />
        Refresh
      </Button>
      <Button size="sm" variant="outline" onClick={onReconnect}>
        <Icon name="LogIn" className="size-4" />
        Reconnect AWS
      </Button>
    </div>
  );
}

function FooterCredits() {
  const { summary, error, loading, message, load, reconnect } = useCredits();
  return (
    <div className="w-[min(22rem,calc(100vw-1.5rem))] space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Icon name="Cloud" className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">AWS Activate</p>
            <p className="text-xs text-muted-foreground">
              {summary ? `Account ${maskedAccount(summary.accountId)}` : "AWS promotional credits"}
            </p>
          </div>
        </div>
        {summary ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {compactUsd.format(summary.estimated)} left
          </span>
        ) : null}
      </div>
      {summary === null && loading ? <LoadingBox /> : null}
      {summary === null && error !== null ? <ErrorBox error={error} onReconnect={() => void reconnect()} /> : null}
      {summary !== null ? <BalanceSummary summary={summary} compact /> : null}
      {summary?.warning ? <Warning>{summary.warning}</Warning> : null}
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      <ActionRow loading={loading} onRefresh={() => void load(true)} onReconnect={() => void reconnect()} />
      {summary ? (
        <p className="text-[11px] text-muted-foreground">
          Updated {formatUpdated(summary.fetchedAt)} · AWS estimates update daily
        </p>
      ) : null}
    </div>
  );
}

function CreditsPage() {
  const { summary, error, loading, message, load, reconnect } = useCredits();
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-4xl space-y-5 px-4 pb-8 pt-4 md:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AWS Activate credits</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Official balances from AWS Billing. Credentials stay in your local AWS profile.
            </p>
          </div>
          <ActionRow loading={loading} onRefresh={() => void load(true)} onReconnect={() => void reconnect()} />
        </div>

        {message ? <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{message}</p> : null}
        {summary === null && loading ? <LoadingBox /> : null}
        {summary === null && error !== null ? <ErrorBox error={error} onReconnect={() => void reconnect()} /> : null}

        {summary !== null ? (
          <>
            {summary.warning ? <Warning>{summary.warning}</Warning> : null}
            <div className="grid gap-4 md:grid-cols-[1.35fr_1fr]">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon name="WalletCards" className="size-5 text-amber-500" />
                    Credit balance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <BalanceSummary summary={summary} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon name="ChartColumn" className="size-5 text-sky-500" />
                    Current month
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-3xl font-semibold tabular-nums">{usd.format(summary.monthUsed)}</p>
                  <p className="text-xs text-muted-foreground">
                    Credits applied in {summary.month}{summary.allocationIsEstimated ? " · estimated bill" : ""}
                  </p>
                  <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                    AWS Billing reports credit applications by billing month. The total includes Bedrock and other eligible AWS services.
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Active credits</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {summary.credits.map((credit) => (
                  <div key={credit.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{credit.description}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Expires {formatDate(credit.expiresAt)}</p>
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <p className="text-sm font-semibold tabular-nums">{usd.format(credit.estimated)}</p>
                      <p className="text-xs text-muted-foreground">of {usd.format(credit.initial)}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {summary.serviceUsage.length > 0 ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Where credits were applied this month</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {summary.serviceUsage.map((item) => (
                    <div key={item.service} className="flex items-center justify-between gap-4 text-sm">
                      <span className="min-w-0 truncate text-muted-foreground">{readableService(item.service)}</span>
                      <span className="shrink-0 font-medium tabular-nums">{usd.format(item.amount)}</span>
                    </div>
                  ))}
                  <p className="pt-2 text-xs text-muted-foreground">
                    Marketplace model SKUs can appear as AWS product identifiers until the bill is finalized.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Profile {summary.profile} · account {summary.accountId} · updated {formatUpdated(summary.fetchedAt)}
              {summary.stale ? " · cached result" : ""}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "aws-activate-credits",
    title: "AWS credits",
    icon: "Cloud",
    path: "credits",
    component: CreditsPage,
  });

  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "aws-activate-credits",
    label: "AWS Activate credits",
    icon: "Cloud",
    component: FooterCredits,
  });
});
