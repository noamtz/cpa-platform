# ─── Terraform Configuration ──────────────────────────────────────────────────
# PDF Generator Lambda + API Gateway (Production Environment)
# Taxflow account: 006296770641 | Region: il-central-1
#
# Key difference from test: Lambda alias "live" for version tracking + rollback.
# API Gateway routes to the alias, not $LATEST.
# The alias version is managed by GitHub Actions, NOT Terraform.

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "taxflow-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "il-central-1"
    dynamodb_table = "taxflow-terraform-locks"
    encrypt        = true
    profile        = "ntz-taxflow"
  }
}

provider "aws" {
  region  = var.aws_region
  profile = "ntz-taxflow"

  default_tags {
    tags = {
      project     = var.project
      environment = var.environment
      managed_by  = "terraform"
    }
  }
}

# ─── Variables ────────────────────────────────────────────────────────────────

variable "project" {
  default = "taxflow"
}

variable "environment" {
  default = "prod"
}

variable "aws_region" {
  default = "il-central-1"
}

variable "lambda_memory_mb" {
  description = "Lambda memory in MB (pdfme + pdf.js rendering needs ~1024MB)"
  default     = 1024
}

variable "lambda_timeout_seconds" {
  description = "Lambda timeout in seconds"
  default     = 60
}

variable "cors_origin" {
  description = "Allowed CORS origin for the API"
  default     = "*"
}

# ─── Data ─────────────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}

# ─── GitHub Actions OIDC (account-level, shared by all environments) ─────────

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = {
    repo = "auditflow"
  }
}

resource "aws_iam_role" "github_actions" {
  name = "github-actions-taxflow"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:noamtz/auditflow:*"
        }
      }
    }]
  })

  tags = {
    purpose = "github-actions-ci-cd"
    repo    = "auditflow"
  }
}

resource "aws_iam_role_policy_attachment" "github_actions_admin" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# ─── IAM Role for Lambda ─────────────────────────────────────────────────────

resource "aws_iam_role" "pdf_generator" {
  name = "${var.project}-pdf-generator-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "pdf_generator_basic" {
  role       = aws_iam_role.pdf_generator.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ─── Lambda Deployment Package (S3, >50MB) ────────────────────────────────────

resource "aws_s3_bucket" "lambda_deployments" {
  bucket = "${var.project}-lambda-deployments-${var.environment}"
}

resource "aws_s3_object" "pdf_generator_zip" {
  bucket = aws_s3_bucket.lambda_deployments.id
  key    = "pdf-generator/deployment.zip"
  source = "${path.module}/../../lambda/pdf-generator/deployment.zip"
  etag   = filemd5("${path.module}/../../lambda/pdf-generator/deployment.zip")
}

# ─── Lambda Function ─────────────────────────────────────────────────────────

resource "aws_lambda_function" "pdf_generator" {
  function_name = "${var.project}-pdf-generator-${var.environment}"
  description   = "Server-side PDF generation + page rendering (${var.environment})"

  s3_bucket        = aws_s3_bucket.lambda_deployments.id
  s3_key           = aws_s3_object.pdf_generator_zip.key
  source_code_hash = filebase64sha256("${path.module}/../../lambda/pdf-generator/deployment.zip")

  handler     = "index.handler"
  runtime     = "nodejs20.x"
  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_seconds
  architectures = ["arm64"]

  # Publish a version on every code change (required for alias-based routing)
  publish = true

  role = aws_iam_role.pdf_generator.arn

  environment {
    variables = {
      CORS_ORIGIN = var.cors_origin
      NODE_ENV    = var.environment
    }
  }

  depends_on = [aws_s3_object.pdf_generator_zip]
}

# ─── Lambda Alias "live" ─────────────────────────────────────────────────────
# API Gateway routes to this alias. Deploy/rollback workflows update it.
# Terraform ignores function_version changes so CI-managed versions aren't reverted.

resource "aws_lambda_alias" "live" {
  name             = "live"
  description      = "Production traffic alias — managed by GitHub Actions deploy/rollback"
  function_name    = aws_lambda_function.pdf_generator.function_name
  function_version = aws_lambda_function.pdf_generator.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

# ─── API Gateway (HTTP API v2) ────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "pdf_api" {
  name          = "${var.project}-pdf-api-${var.environment}"
  protocol_type = "HTTP"
  description   = "PDF generation API (${var.environment})"

  # CORS configuration removed: We are managing CORS manually in the Lambda
  # because Safari has a bug where it fails on HTTP 204 No Content preflight responses 
  # lacking a Content-Length header, which API Gateway automatically returns.
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.pdf_api.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gw.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
      errorMessage   = "$context.error.message"
    })
  }
}

resource "aws_cloudwatch_log_group" "api_gw" {
  name              = "/aws/apigateway/${var.project}-pdf-api-${var.environment}"
  retention_in_days = 30
}

# ─── API Gateway Integration + Routes ────────────────────────────────────────
# Integration points to the "live" ALIAS, not $LATEST

resource "aws_apigatewayv2_integration" "pdf_generator" {
  api_id                 = aws_apigatewayv2_api.pdf_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_alias.live.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "generate_pdf" {
  api_id    = aws_apigatewayv2_api.pdf_api.id
  route_key = "POST /generate-pdf"
  target    = "integrations/${aws_apigatewayv2_integration.pdf_generator.id}"
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.pdf_api.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.pdf_generator.id}"
}

resource "aws_apigatewayv2_route" "render_pages" {
  api_id    = aws_apigatewayv2_api.pdf_api.id
  route_key = "POST /render-pages"
  target    = "integrations/${aws_apigatewayv2_integration.pdf_generator.id}"
}

resource "aws_apigatewayv2_route" "options" {
  api_id    = aws_apigatewayv2_api.pdf_api.id
  route_key = "OPTIONS /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.pdf_generator.id}"
}

# ─── Lambda Permission for API Gateway ────────────────────────────────────────
# Permission on the ALIAS (not the function directly)

resource "aws_lambda_permission" "api_gw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pdf_generator.function_name
  qualifier     = aws_lambda_alias.live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.pdf_api.execution_arn}/*/*"
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "api_url" {
  description = "API Gateway endpoint URL"
  value       = aws_apigatewayv2_api.pdf_api.api_endpoint
}

output "lambda_function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.pdf_generator.function_name
}

output "lambda_function_arn" {
  description = "Lambda function ARN"
  value       = aws_lambda_function.pdf_generator.arn
}

output "lambda_alias_arn" {
  description = "Lambda live alias ARN (API Gateway routes here)"
  value       = aws_lambda_alias.live.arn
}

output "lambda_version" {
  description = "Currently published Lambda version"
  value       = aws_lambda_function.pdf_generator.version
}

output "github_actions_role_arn" {
  description = "GitHub Actions OIDC role ARN"
  value       = aws_iam_role.github_actions.arn
}
