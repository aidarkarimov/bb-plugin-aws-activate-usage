# AWS Activate Usage for BB

A BB plugin that reads official promotional-credit data from AWS Billing through
an existing local AWS CLI profile.

It adds:

- an AWS credits page;
- an AWS Activate footer disclosure;
- compact and detailed sidebar layouts, selectable in plugin settings;
- cached balance and expiration details;
- current-month credit allocation totals;
- configurable estimated spend for today or yesterday in the compact sidebar row;
- an AWS reconnect action;
- `bb aws-activate-usage summary|refresh|login`.

No permanent AWS keys are stored by the plugin. Configuration lives in BB's
plugin settings. The AWS account is detected with `aws sts
get-caller-identity`; users can override it with a 12-digit account ID.

## Requirements

- BB 0.46 or newer.
- AWS CLI v2 available as `aws`, or a custom CLI path in plugin settings.
- An AWS CLI profile with permission to call `billing:GetCredits`,
  `billing:GetCreditAllocationHistory`, `ce:GetCostAndUsage`, and
  `sts:GetCallerIdentity`.
- AWS Billing access enabled for the IAM identity.

## Install from source

Clone the repository, then run:

```sh
npm ci
bb plugin build .
bb plugin install . --yes
```

Open **AWS credits** in BB. The default profile is `default`. If credentials
expire, **Reconnect AWS** runs `aws sso login --profile <profile>`. A user with
a different authentication flow can configure an executable reconnect helper.

For helpers that use `aws login`, AWS can first select an AWS Builder ID and
show **You don't have any projects yet**. That is the Builder ID project page,
not the AWS account. Choose **Add session** (not **Create project**), sign in to
the intended AWS account, return to BB, and press **Refresh**. Once that account
session exists in the browser, later reconnects can reuse it.

## Commands

```sh
bb aws-activate-usage summary
bb aws-activate-usage refresh
bb aws-activate-usage login
```

AWS labels current billing data as estimated and refreshes it on its own
schedule. The plugin keeps the last successful result available when a session
expires.

## Sidebar display

Open the plugin settings and choose **Sidebar display**:

- `compact` keeps the current balance, remaining percentage, refresh, and reconnect actions in one row;
- `detailed` shows the large balance card with progress and expiration details.

The full **AWS credits** page remains detailed in either mode.

Use **Daily spend shown** to choose `today` (the default) or `yesterday`. The
amount in parentheses after the compact balance is the selected day's estimated
gross AWS spend from Cost Explorer. Current-day data can lag while AWS processes
usage, so yesterday is useful when you want a more complete daily total;
**Refresh** requests the newest available estimate.
