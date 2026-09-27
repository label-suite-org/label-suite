#!/usr/bin/env bash
set -euo pipefail

readonly ingress_base_url="${DOKPLOY_WEBHOOK_INGRESS_URL:-https://label-suite-deploy.truenature.online}"
readonly -a ingress_checks=(
  "GET /api/deploy/github 404"
  "POST /api/deploy/github 401"
  "GET /github 404"
  "POST /github 404"
  "GET / 404"
)

for ingress_check in "${ingress_checks[@]}"; do
  read -r ingress_method ingress_route ingress_expected <<<"${ingress_check}"
  ingress_curl_args=(
    --silent
    --show-error
    --output /dev/null
    --write-out "%{http_code}"
    --connect-timeout 5
    --max-time 10
    --request "${ingress_method}"
  )

  if [[ "${ingress_method}" == "POST" ]]; then
    ingress_curl_args+=(--header "Content-Type: application/json" --data-binary "{}")
  fi

  ingress_actual="$(curl "${ingress_curl_args[@]}" "${ingress_base_url}${ingress_route}")"
  if [[ "${ingress_actual}" != "${ingress_expected}" ]]; then
    printf 'dokploy-webhook-ingress: %s %s expected %s, received %s\n' \
      "${ingress_method}" "${ingress_route}" "${ingress_expected}" "${ingress_actual}" >&2
    exit 1
  fi

  printf 'dokploy-webhook-ingress: %s %s -> %s\n' \
    "${ingress_method}" "${ingress_route}" "${ingress_actual}"
done
