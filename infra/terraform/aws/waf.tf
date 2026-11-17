# AWS WAFv2 asociado al ALB. Reglas administradas OWASP + rate limiting en login.

resource "aws_wafv2_ip_set" "admin_allow" {
  count              = length(var.admin_allowed_cidrs) > 0 ? 1 : 0
  name               = "${local.name}-admin-allow"
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = var.admin_allowed_cidrs
}

resource "aws_wafv2_web_acl" "main" {
  name        = "${local.name}-waf"
  description = "WAF tienda en linea - OWASP Top 10, reputacion IP y fuerza bruta"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # 1. IPs con mala reputación (botnets, scanners)
  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  # 2. Rate limit en el login (fuerza bruta / credential stuffing)
  rule {
    name     = "RateLimitLogin"
    priority = 2
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.login_rate_limit
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
        # Solo POST a rutas de autenticación: los endpoints HTTP de Better Auth (/api/auth/*)
        # y las Server Actions de la interfaz (/login, /login/2fa, /registro, /recuperar, /restablecer).
        scope_down_statement {
          and_statement {
            statement {
              byte_match_statement {
                search_string         = "POST"
                positional_constraint = "EXACTLY"
                field_to_match {
                  method {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
            statement {
              regex_pattern_set_reference_statement {
                arn = aws_wafv2_regex_pattern_set.rutas_auth.arn
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "LOWERCASE"
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-login"
      sampled_requests_enabled   = true
    }
  }

  # 3. Conjunto común (OWASP Top 10: XSS, LFI, RFI, tamaños, etc.)
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 3
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
        # Permite subir imágenes de producto (hasta el límite de la app) en /admin
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "common-rule-set"
      sampled_requests_enabled   = true
    }
  }

  # 4. Entradas maliciosas conocidas (Log4Shell, etc.)
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 4
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # 5. Inyección SQL
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 5
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "sqli-rule-set"
      sampled_requests_enabled   = true
    }
  }

  # 6. (Opcional) /admin sólo desde CIDRs autorizados
  dynamic "rule" {
    for_each = length(var.admin_allowed_cidrs) > 0 ? [1] : []
    content {
      name     = "AdminSoloIPsAutorizadas"
      priority = 6
      action {
        block {}
      }
      statement {
        and_statement {
          statement {
            byte_match_statement {
              search_string         = "/admin"
              positional_constraint = "STARTS_WITH"
              field_to_match {
                uri_path {}
              }
              text_transformation {
                priority = 0
                type     = "LOWERCASE"
              }
            }
          }
          statement {
            not_statement {
              statement {
                ip_set_reference_statement {
                  arn = aws_wafv2_ip_set.admin_allow[0].arn
                }
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "admin-ip-allowlist"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-waf"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}

# Logs del WAF -> CloudWatch (el nombre DEBE empezar con "aws-waf-logs-")
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${local.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
}

resource "aws_wafv2_web_acl_logging_configuration" "main" {
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  resource_arn            = aws_wafv2_web_acl.main.arn

  # No registrar credenciales ni cookies de sesión en los logs
  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
  redacted_fields {
    single_header {
      name = "cookie"
    }
  }
}

# Rutas de autenticación sujetas al límite de tasa estricto (regla RateLimitLogin).
resource "aws_wafv2_regex_pattern_set" "rutas_auth" {
  name        = "${local.name}-rutas-auth"
  description = "Endpoints de login, 2FA, registro y recuperacion (Better Auth y Server Actions)"
  scope       = "REGIONAL"

  regular_expression {
    regex_string = "^/api/auth/(sign-in|sign-up|request-password-reset|reset-password|two-factor)"
  }
  regular_expression {
    regex_string = "^/(login|login/2fa|registro|recuperar|restablecer)/?$"
  }
}
