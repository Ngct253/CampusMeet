# M4 cloud setup

Code and infrastructure are committed without credentials. Complete these account-level steps before an end-to-end deployment.

## Required local runtime

- Node.js 22 LTS or newer.
- AWS CLI and AWS SAM CLI authenticated to the target account.
- A Google Cloud project whose numeric project number is available to the web build.

## AWS deployment order

The M4 stack owns the private user-content bucket and Step Functions state machine. The M5 application stack owns the AI Worker. The worker has a deterministic name, so deploy in this order:

1. Determine the worker ARN: `arn:aws:lambda:<region>:<account-id>:function:campusmeet-<environment>-ai-worker`.
2. Deploy `infra/user-content-orchestration.yaml` using that ARN. CloudFormation can create the state machine before the Lambda exists.
3. Copy the `UserContentBucketName` and `AIStateMachineArn` outputs.
4. Put those outputs in the parameters used to deploy `infra/template.yaml`.
5. Deploy `infra/template.yaml`, which creates the API, AI Worker, Reminder Lambda, Scheduler role and SES configuration set.

The SES sender supplied as `SesFromEmail` must already be verified. Accounts still in the SES sandbox can send only to verified recipients.

## Google Meet Add-on

1. Create or select a Google Cloud project and enable Google Workspace Marketplace SDK.
2. Configure OAuth consent and create a web OAuth client.
3. Add the deployed HTTPS callback/origin URLs. Never place the client secret in Vite variables.
   - Authorized JavaScript origin: the CloudFront origin, for example `https://example.cloudfront.net`.
   - Authorized redirect URI: the exact API URL ending in `/integrations/google/callback`.
   - Store JSON keys `clientId` and `clientSecret` in the Secrets Manager secret named by `GoogleSecretReference`.
4. Set `VITE_GOOGLE_CLOUD_PROJECT_NUMBER` to the numeric project number.
5. Replace every `campusmeet.example.com` URL in `integrations/google-meet-addon/deployment.json` with the deployed HTTPS origin.
6. Create an unpublished HTTP deployment in the Marketplace SDK and paste the manifest.
7. Install it for test users and verify the side panel in an active Meet call.

SDK reference: https://developers.google.com/workspace/meet/add-ons/guides/get-client

Deployment reference: https://developers.google.com/workspace/meet/add-ons/guides/deploy-add-on

## Current integration boundary

- Document attachments create an `INGEST_SOURCE` AIJob and start the M4 state machine.
- Audio upload is accepted by the UI contract, but completion is rejected until a `BATCH_TRANSCRIPTION` worker using Amazon Transcribe is implemented.
- The Meet side panel and secure internal meeting lookup are implemented.
- Google OAuth connect/callback, one-time state validation and token exchange are implemented. User tokens are stored in the encrypted identity table; OAuth client credentials remain in Secrets Manager.
- Calendar event synchronization still needs to use the stored refresh token and map Google conference creation states.
