# AWS Activate Usage for BB

A BB plugin that reads official promotional-credit data from AWS Billing through
an existing local AWS CLI profile.

It adds:

- an AWS credits page;
- an AWS Activate footer disclosure;
- cached balance and expiration details;
- current-month credit allocation totals;
- an AWS reconnect action;
- `bb aws-activate-usage summary|refresh|login`.

No permanent AWS keys are stored by the plugin. Configuration lives in BB's
plugin settings. The AWS account is detected with `aws sts
get-caller-identity`; users can override it with a 12-digit account ID.

## Requirements

- BB 0.46 or newer.
- AWS CLI v2 available as `aws`, or a custom CLI path in plugin settings.
- An AWS CLI profile with permission to call `billing:GetCredits`,
  `billing:GetCreditAllocationHistory`, and `sts:GetCallerIdentity`.
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

## Commands

```sh
bb aws-activate-usage summary
bb aws-activate-usage refresh
bb aws-activate-usage login
```

AWS labels current billing data as estimated and refreshes it on its own
schedule. The plugin keeps the last successful result available when a session
expires.
