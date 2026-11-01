#!/usr/bin/env bash
# The backstop: tells you before the bill surprises you.
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
read -rp "Monthly USD budget for this project [20]: " AMOUNT; AMOUNT="${AMOUNT:-20}"
read -rp "Email for alerts: " EMAIL

aws budgets create-budget --account-id "$ACCOUNT" --budget "{
  \"BudgetName\":\"kurultai\",
  \"BudgetLimit\":{\"Amount\":\"${AMOUNT}\",\"Unit\":\"USD\"},
  \"TimeUnit\":\"MONTHLY\",\"BudgetType\":\"COST\"
}" --notifications-with-subscribers "[
  {\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",
    \"Threshold\":50,\"ThresholdType\":\"PERCENTAGE\"},
   \"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"${EMAIL}\"}]},
  {\"Notification\":{\"NotificationType\":\"FORECASTED\",\"ComparisonOperator\":\"GREATER_THAN\",
    \"Threshold\":100,\"ThresholdType\":\"PERCENTAGE\"},
   \"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"${EMAIL}\"}]}
]"
echo
echo "Alerts at 50% actual and 100% forecast."
echo "This warns, it does not stop. The hard stop is globalRunsPerDay in lambda/config.mjs,"
echo "plus a spend limit set on the Anthropic side."
