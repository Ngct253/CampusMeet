# M4 cloud setup

Code and infrastructure are committed without credentials. Complete these account-level steps before an end-to-end deployment.

## Required local runtime

- Node.js 22 LTS or newer.
- AWS CLI and AWS SAM CLI authenticated to the target account.
- A Google Cloud project whose numeric project number is available to the web build.

## AWS deployment order

The standalone M4 stack owns the private user-content bucket, Step Functions state machine, Reminder Lambda, Scheduler execution role and SES configuration set. The data-foundation stack owns the Meeting table and its DynamoDB Stream. The application stack owns the API, Google Sync Worker and the M5 AI Worker. The worker has a deterministic name, so deploy in this order:

1. Deploy/update `infra/data-foundation.yaml`. Copy its `MeetingDataTableStreamArn` output.
2. Determine the worker ARN: `arn:aws:lambda:<region>:<account-id>:function:campusmeet-<environment>-ai-worker`.
3. Deploy `infra/user-content-orchestration.yaml` using that ARN, the data-table prefix and the verified SES sender. CloudFormation can create the state machine before the AI Worker exists.
4. Copy the `UserContentBucketName`, `AIStateMachineArn`, `ReminderFunctionArn`, `SchedulerExecutionRoleArn` and `SesConfigurationSetName` outputs.
5. Put those outputs and `MeetingDataTableStreamArn` in the parameters used to deploy `infra/template.yaml`.
6. Deploy `infra/template.yaml`, which creates the shared API, M4 Google Sync Worker and M5 AI resources while consuming the M4 outputs.

The Google Sync Worker asynchronously reconciles create/update/cancel operations. It uses a durable `GoogleMeetingSyncRecord`, deterministic Google event identity, stale-revision guards and at most five one-shot retries after 1 minute, 5 minutes, 15 minutes, 1 hour and 6 hours. `POST /meetings/:meetingId/google-sync/retry` is restricted to active Group Admins.

Do not deploy the standalone M4 stack over manually-created resources with the same physical names. Import/adopt those resources into CloudFormation first, or deploy the stack with non-conflicting names and migrate deliberately.

For a brownfield environment whose user-content bucket was created manually, pass its name as `ExistingUserContentBucketName`. The stack then reuses that bucket and doesn't create or manage its CORS, encryption, public-access block or lifecycle settings. Leave the parameter empty in a clean environment so CloudFormation creates and manages the bucket.

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
- Calendar event synchronization uses the stored refresh token, creates Google conference data and stores the Google event/meeting references.
