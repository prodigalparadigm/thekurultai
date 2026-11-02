#!/usr/bin/env bash
# One-shot deploy. Run from the project root: infra/deploy.sh
# Assumes the AWS CLI is configured (`aws sts get-caller-identity` works).
#
# Shape, which is flyer-to-fork's with one difference:
#
#   page (GitHub Pages) --CORS--> API Gateway -> Lambda --async self-invoke--> Lambda
#                                                   |                            |
#                                        SSM SecureString (the key)      Anthropic API
#                                        DynamoDB (limits + results)
#
# The difference is the self-invoke. A strategy document takes minutes and API
# Gateway's hard ceiling on a request is 30 seconds, so the request only books
# the job and hands back a ticket; the work happens in a second, asynchronous
# invocation of the same function and the page polls for it. Lambda function
# URLs, which have no such ceiling, are blocked account-wide on this account -
# that is settled, not worth re-testing.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
FN="kurultai-engine"
TABLE="KurultaiLimits"
PARAM="/kurultai/anthropic-api-key"
SALT_PARAM="/kurultai/ip-salt"
ROLE="kurultai-engine-role"
API="kurultai-api"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

say() { printf "\n\033[1m==> %s\033[0m\n" "$1"; }

say "1/7  API key -> SSM (encrypted)"
if ! aws ssm get-parameter --name "$PARAM" --region "$REGION" >/dev/null 2>&1; then
  # read without echoing to the terminal or the shell history
  read -rsp "Paste the Anthropic API key (hidden), then Enter: " KEY; echo
  aws ssm put-parameter --name "$PARAM" --type SecureString --value "$KEY" \
    --region "$REGION" --description "Kurultai engine key" >/dev/null
  unset KEY
  echo "stored."
else
  echo "already present (rotate with: aws ssm put-parameter --name $PARAM --type SecureString --value NEWKEY --overwrite)"
fi

say "1b/7  IP salt -> SSM (encrypted)"
# The salt that hashes visitor IPs must not live in a public repo. Minted once
# here, never printed, read into the function's environment at deploy time.
if ! aws ssm get-parameter --name "$SALT_PARAM" --region "$REGION" >/dev/null 2>&1; then
  aws ssm put-parameter --name "$SALT_PARAM" --type SecureString \
    --value "$(openssl rand -hex 32)" --region "$REGION" \
    --description "Salt for hashing visitor IPs in the rate limiter" >/dev/null
  echo "minted."
else
  echo "already present."
fi
IP_SALT="$(aws ssm get-parameter --name "$SALT_PARAM" --with-decryption --region "$REGION" --query Parameter.Value --output text)"

say "2/7  DynamoDB table for the limits and the finished documents"
aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1 || {
  aws dynamodb create-table --table-name "$TABLE" --region "$REGION" \
    --attribute-definitions AttributeName=pk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
  # buckets, day counters and finished documents all delete themselves
  aws dynamodb update-time-to-live --table-name "$TABLE" --region "$REGION" \
    --time-to-live-specification "Enabled=true,AttributeName=expires" >/dev/null
  echo "created."
}

say "3/7  IAM role, scoped to exactly these three resources"
aws iam get-role --role-name "$ROLE" >/dev/null 2>&1 || {
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 10   # IAM is eventually consistent
}
aws iam put-role-policy --role-name "$ROLE" --policy-name engine-access --policy-document "{
  \"Version\":\"2012-10-17\",
  \"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":[\"ssm:GetParameter\"],
     \"Resource\":[\"arn:aws:ssm:${REGION}:${ACCOUNT}:parameter${PARAM}\",\"arn:aws:ssm:${REGION}:${ACCOUNT}:parameter${SALT_PARAM}\"]},
    {\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\",\"dynamodb:PutItem\",\"dynamodb:UpdateItem\"],
     \"Resource\":\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}\"},
    {\"Effect\":\"Allow\",\"Action\":[\"lambda:InvokeFunction\"],
     \"Resource\":\"arn:aws:lambda:${REGION}:${ACCOUNT}:function:${FN}\"}
  ]}"

say "4/7  bundle"
# The slider poles are canon and live in one file. It is copied in at bundle
# time rather than kept in two places, so the page, the engine and the QA
# harness cannot drift apart.
cp canon/sliders.json lambda/sliders.json
( cd lambda && npm install --omit=dev --silent && rm -f ../function.zip && zip -qr ../function.zip . -x 'node_modules/.package-lock.json' )

say "5/7  function"
if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --zip-file fileb://function.zip \
    --region "$REGION" >/dev/null
else
  aws lambda create-function --function-name "$FN" --region "$REGION" \
    --runtime nodejs22.x --handler index.handler \
    --role "arn:aws:iam::${ACCOUNT}:role/${ROLE}" \
    --zip-file fileb://function.zip --timeout 600 --memory-size 1024 \
    --environment "Variables={SELF_FUNCTION=${FN},IP_SALT=${IP_SALT}}" >/dev/null
  # Cap how far a burst can fan out. On a new account the total concurrency
  # limit is 10 and AWS refuses to let reservations drop the unreserved pool
  # below that, so this is allowed to fail: the account limit is already the cap.
  aws lambda put-function-concurrency --function-name "$FN" \
    --reserved-concurrent-executions 5 --region "$REGION" >/dev/null 2>&1 \
    || echo "   (skipped: account concurrency limit already caps the blast radius)"
fi
aws lambda wait function-updated --function-name "$FN" --region "$REGION"
# 600s covers the worker invocation. The request path answers in well under a
# second; it is the same function, so it takes the same timeout.
aws lambda update-function-configuration --function-name "$FN" --region "$REGION" \
  --timeout 600 --environment "Variables={SELF_FUNCTION=${FN},IP_SALT=${IP_SALT}}" >/dev/null
aws lambda wait function-updated --function-name "$FN" --region "$REGION"

# Lambda retries a failed ASYNC invocation twice by default. The worker's own
# try/catch handles its errors, but a timeout or an out-of-memory kill escapes
# it, and the job then reruns up to twice more without passing the daily cap.
aws lambda put-function-event-invoke-config --function-name "$FN" --region "$REGION" \
  --maximum-retry-attempts 0 >/dev/null 2>&1 && echo "   async retries set to 0" \
  || echo "   (could not set async retry config; check it by hand)"

say "6/7  HTTP API"
APIID="$(aws apigatewayv2 get-apis --region "$REGION" \
  --query "Items[?Name=='${API}'].ApiId | [0]" --output text)"
if [ "$APIID" = "None" ] || [ -z "$APIID" ]; then
  APIID="$(aws apigatewayv2 create-api --region "$REGION" --name "$API" \
    --protocol-type HTTP --target "arn:aws:lambda:${REGION}:${ACCOUNT}:function:${FN}" \
    --query ApiId --output text)"
  # create-api --target makes a default $default route; replace it with the two
  # routes this service actually has, so nothing else is reachable.
  for R in 'POST /run' 'GET /run' 'OPTIONS /run'; do
    INTEG="$(aws apigatewayv2 get-integrations --api-id "$APIID" --region "$REGION" \
      --query 'Items[0].IntegrationId' --output text)"
    aws apigatewayv2 create-route --api-id "$APIID" --region "$REGION" \
      --route-key "$R" --target "integrations/${INTEG}" >/dev/null
  done
  DEF="$(aws apigatewayv2 get-routes --api-id "$APIID" --region "$REGION" \
    --query "Items[?RouteKey=='\$default'].RouteId | [0]" --output text)"
  [ "$DEF" != "None" ] && aws apigatewayv2 delete-route --api-id "$APIID" \
    --region "$REGION" --route-id "$DEF" >/dev/null || true
  aws lambda add-permission --function-name "$FN" --region "$REGION" \
    --statement-id apigw-invoke --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT}:${APIID}/*/*/run" >/dev/null 2>&1 || true
  echo "created $APIID."
else
  echo "already present ($APIID)."
fi
ENDPOINT="$(aws apigatewayv2 get-api --api-id "$APIID" --region "$REGION" \
  --query ApiEndpoint --output text)/run"
rm -f function.zip

say "7/7  done"
echo "$ENDPOINT" > .endpoint
echo "Endpoint: $ENDPOINT"
echo
echo "Put that into KURULTAI_ENDPOINT at the top of thekurultai/app.js."
echo "Then set a budget alarm:  infra/budget-alarm.sh"
echo
echo "CORS is an allowlist in lambda/config.mjs, not a wildcard. If the page is"
echo "served from an origin that is not on it, the browser will refuse the reply"
echo "and the console will say so plainly."
