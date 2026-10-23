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
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const day = sameDay
    ? "Today"
    : new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${day}, ${time}`;
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
      className="h-2 overflow-hidden rounded-full bg-muted-foreground/20"
      role="progressbar"
      aria-label="AWS credits remaining"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(remainingPercent)}
    >
      <div
        className="h-full rounded-full bg-amber-400 transition-[width] duration-300 motion-reduce:transition-none"
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
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
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

function SummaryHeader({ summary, compact = false }: { summary: AwsCreditsSummary; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={`${compact ? "size-11 rounded-2xl" : "size-14 rounded-[1.25rem]"} flex shrink-0 items-center justify-center bg-amber-300 text-slate-950 shadow-[0_10px_30px_-14px_rgba(245,158,11,0.8)]`}>
        <Icon name="Cloud" className={compact ? "size-5" : "size-6"} />
      </span>
      <div className="min-w-0">
        <h1 className={`${compact ? "text-lg" : "text-2xl"} truncate font-bold tracking-tight`}>AWS Activate</h1>
        <p className={`${compact ? "text-xs" : "text-sm"} truncate font-medium text-muted-foreground`}>
          Account {maskedAccount(summary.accountId)}
        </p>
      </div>
    </div>
  );
}

function CreditHero({ summary, compact = false }: { summary: AwsCreditsSummary; compact?: boolean }) {
  return (
    <section className={`${compact ? "space-y-4 rounded-[1.5rem] p-4" : "space-y-6 rounded-[2rem] p-6"} min-w-0 border border-border/60 bg-muted/70 text-foreground`}>
      <div className="min-w-0">
        <p className={`${compact ? "text-[11px]" : "text-xs"} font-semibold uppercase tracking-[0.14em] text-muted-foreground`}>
          Estimated AWS credits
        </p>
        <p
          className="mt-2 break-words font-semibold leading-none tracking-[-0.04em] tabular-nums"
          style={{ fontSize: compact ? "clamp(2rem, 14cqi, 3.25rem)" : "clamp(2.5rem, 11cqi, 4.75rem)" }}
        >
          {usd.format(summary.estimated)}
        </p>
      </div>
      <div className="space-y-3">
        <ProgressBar usedPercent={summary.usedPercent} />
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs font-semibold text-muted-foreground">
          <span className="tabular-nums">{usd.format(summary.used)} used</span>
          <span className="tabular-nums">of {usd.format(summary.initial)}</span>
        </div>
      </div>
    </section>
  );
}

function ExpiryCard({ summary, compact = false }: { summary: AwsCreditsSummary; compact?: boolean }) {
  const primary = useMemo(
    () => summary.credits.find((credit) => credit.id === summary.primaryCreditId) ?? null,
    [summary],
  );
  if (primary?.expiresAt === null || primary?.expiresAt === undefined) return null;
  return (
    <section className={`${compact ? "rounded-2xl p-3.5" : "rounded-[1.5rem] p-4"} flex min-w-0 items-center gap-3 border border-border/70 bg-muted/60`}>
      <span className={`${compact ? "size-10" : "size-12"} flex shrink-0 items-center justify-center rounded-full bg-background/80 text-amber-500`}>
        <Icon name="Zap" className={compact ? "size-5" : "size-6"} />
      </span>
      <div className="min-w-0">
        <p className={`${compact ? "text-xs" : "text-sm"} font-medium text-muted-foreground`}>Main Activate credit expires</p>
        <p className={`${compact ? "text-base" : "text-lg"} font-semibold tabular-nums`}>{formatDate(primary.expiresAt)}</p>
      </div>
    </section>
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
    <div
      className="grid min-w-0 gap-2"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))" }}
    >
      <Button
        className="h-11 min-w-0 rounded-2xl bg-amber-300 px-4 text-sm font-semibold text-slate-950 shadow-[0_10px_24px_-16px_rgba(245,158,11,0.9)] hover:bg-amber-200 focus-visible:ring-2 focus-visible:ring-amber-400"
        onClick={onRefresh}
        disabled={loading}
      >
        <Icon name={loading ? "LoaderCircle" : "RefreshCw"} className={loading ? "size-4 animate-spin" : "size-4"} />
        Refresh balance
      </Button>
      <Button
        className="h-11 min-w-0 rounded-2xl border-0 bg-muted px-4 text-sm font-semibold text-foreground hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring"
        variant="secondary"
        onClick={onReconnect}
      >
        <Icon name="Link" className="size-4" />
        Reconnect
      </Button>
    </div>
  );
}

function UpdatedLine({ summary }: { summary: AwsCreditsSummary }) {
  return (
    <p className="text-center text-[11px] font-medium text-muted-foreground">
      Updated {formatUpdated(summary.fetchedAt)} <span aria-hidden="true">·</span> AWS estimates update daily
    </p>
  );
}

function CreditOverview({
  summary,
  compact = false,
  loading,
  message,
  onRefresh,
  onReconnect,
}: {
  summary: AwsCreditsSummary;
  compact?: boolean;
  loading: boolean;
  message: string | null;
  onRefresh: () => void;
  onReconnect: () => void;
}) {
  return (
    <div className={compact ? "min-w-0 space-y-3" : "min-w-0 space-y-4"}>
      <SummaryHeader summary={summary} compact={compact} />
      <CreditHero summary={summary} compact={compact} />
      <ExpiryCard summary={summary} compact={compact} />
      {summary.warning ? <Warning>{summary.warning}</Warning> : null}
      {message ? <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs">{message}</p> : null}
      <ActionRow loading={loading} onRefresh={onRefresh} onReconnect={onReconnect} />
      <UpdatedLine summary={summary} />
    </div>
  );
}

function FooterCredits() {
  const { summary, error, loading, message, load, reconnect } = useCredits();
  return (
    <div
      className="w-full min-w-0 max-w-full overflow-hidden bg-background p-3 text-foreground"
      style={{ containerType: "inline-size" }}
    >
      {summary === null && loading ? <LoadingBox /> : null}
      {summary === null && error !== null ? <ErrorBox error={error} onReconnect={() => void reconnect()} /> : null}
      {summary !== null ? (
        <CreditOverview
          summary={summary}
          compact
          loading={loading}
          message={message}
          onRefresh={() => void load(true)}
          onReconnect={() => void reconnect()}
        />
      ) : null}
    </div>
  );
}

function CreditsPage() {
  const { summary, error, loading, message, load, reconnect } = useCredits();
  return (
    <div
      className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto"
      style={{ containerType: "inline-size" }}
    >
      <div className="mx-auto box-border w-full max-w-4xl space-y-4 px-3 pb-8 pt-4">
        {summary === null && loading ? <LoadingBox /> : null}
        {summary === null && error !== null ? <ErrorBox error={error} onReconnect={() => void reconnect()} /> : null}

        {summary !== null ? (
          <>
            <CreditOverview
              summary={summary}
              loading={loading}
              message={message}
              onRefresh={() => void load(true)}
              onReconnect={() => void reconnect()}
            />
            <div
              className="grid min-w-0 gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 17rem), 1fr))" }}
            >
              <Card className="rounded-2xl border-border/70 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon name="ChartColumn" className="size-5 text-sky-500" />
                    Current month
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p
                    className="break-words font-semibold leading-none tabular-nums"
                    style={{ fontSize: "clamp(1.5rem, 9cqi, 1.875rem)" }}
                  >
                    {usd.format(summary.monthUsed)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Credits applied in {summary.month}{summary.allocationIsEstimated ? " · estimated bill" : ""}
                  </p>
                  <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                    AWS Billing reports credit applications by billing month. The total includes Bedrock and other eligible AWS services.
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-2xl border-border/70 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Active credits</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {summary.credits.map((credit) => (
                  <div key={credit.id} className="flex min-w-0 flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3">
                    <div className="min-w-0 flex-[1_1_14rem]">
                      <p className="break-words text-sm font-medium">{credit.description}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Expires {formatDate(credit.expiresAt)}</p>
                    </div>
                    <div className="min-w-0 flex-[0_1_auto] text-right">
                      <p className="text-sm font-semibold tabular-nums">{usd.format(credit.estimated)}</p>
                      <p className="text-xs text-muted-foreground">of {usd.format(credit.initial)}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {summary.serviceUsage.length > 0 ? (
              <Card className="rounded-2xl border-border/70 shadow-sm">
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

            <p className="break-words text-xs text-muted-foreground">
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
