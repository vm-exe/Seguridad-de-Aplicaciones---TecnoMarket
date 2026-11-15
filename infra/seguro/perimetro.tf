# Capa 5 (perímetro cloud): CDN, WAF y API Gateway (riesgos R01, R09 y R16).

resource "aws_wafv2_web_acl" "tienda" {
  name  = "${local.nombre}-waf"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # R16: XML-RPC bloqueado en el perímetro.
  rule {
    name     = "bloquear-xmlrpc"
    priority = 1

    action {
      block {}
    }

    statement {
      byte_match_statement {
        search_string         = "/xmlrpc.php"
        positional_constraint = "ENDS_WITH"
        field_to_match {
          uri_path {}
        }
        text_transformation {
          priority = 0
          type     = "LOWERCASE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "bloquear-xmlrpc"
      sampled_requests_enabled   = true
    }
  }

  # R01: límite de peticiones por IP al inicio de sesión (ventana de 5 minutos).
  rule {
    name     = "limite-inicio-de-sesion"
    priority = 2

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 100
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string         = "/wp-login.php"
            positional_constraint = "ENDS_WITH"
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

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "limite-inicio-de-sesion"
      sampled_requests_enabled   = true
    }
  }

  # R09: límite general de peticiones por IP.
  rule {
    name     = "limite-general"
    priority = 3

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "limite-general"
      sampled_requests_enabled   = true
    }
  }

  # Vulnerabilidades comunes (OWASP Top 10)
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonRuleSet"
      sampled_requests_enabled   = true
    }
  }

  # Entradas maliciosas conocidas, incluida Log4j
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 20

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
      metric_name                = "AWSManagedRulesKnownBadInputsRuleSet"
      sampled_requests_enabled   = true
    }
  }

  # Inyeccion SQL (R03)
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 30

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
      metric_name                = "AWSManagedRulesSQLiRuleSet"
      sampled_requests_enabled   = true
    }
  }

  # Ataques especificos de PHP
  rule {
    name     = "AWSManagedRulesPHPRuleSet"
    priority = 40

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesPHPRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesPHPRuleSet"
      sampled_requests_enabled   = true
    }
  }

  # Ataques especificos de WordPress
  rule {
    name     = "AWSManagedRulesWordPressRuleSet"
    priority = 50

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesWordPressRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesWordPressRuleSet"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.nombre}-waf"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_logging_configuration" "tienda" {
  resource_arn            = aws_wafv2_web_acl.tienda.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
}

# ---------- CloudFront

# Identificadores de las políticas administradas por AWS.
locals {
  cache_desactivada       = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
  cache_optimizada        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized
  reenviar_todo_al_origen = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer
}

# Cabeceras de seguridad que CloudFront añade a toda respuesta.
resource "aws_cloudfront_response_headers_policy" "seguridad" {
  name = "${local.nombre}-cabeceras-de-seguridad"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "SAMEORIGIN"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

resource "aws_cloudfront_distribution" "tienda" {
  #checkov:skip=CKV2_AWS_47:Se aplica KnownBadInputs (Log4j); no se usa AnonymousIpList porque bloquearia a clientes legitimos que navegan con VPN
  #checkov:skip=CKV2_AWS_46:No hay origenes S3; los origenes son el balanceador y API Gateway
  #checkov:skip=CKV_AWS_374:La tienda vende en todo el pais y recibe visitas internacionales; no se aplica restriccion geografica
  #checkov:skip=CKV_AWS_310:No se define un origen de respaldo; la disponibilidad se cubre con dos zonas (riesgo R14)
  #checkov:skip=CKV2_AWS_42:El certificado propio se entrega por la variable certificado_acm_arn
  enabled             = true
  comment             = "TecnoMarket GT"
  aliases             = [var.dominio]
  default_root_object = "index.php"
  web_acl_id          = aws_wafv2_web_acl.tienda.arn
  http_version        = "http2and3"

  origin {
    origin_id   = "balanceador"
    domain_name = aws_lb.tienda.dns_name

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  origin {
    origin_id   = "api"
    domain_name = replace(aws_apigatewayv2_api.tienda.api_endpoint, "https://", "")

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Contenido dinámico: sin caché.
  default_cache_behavior {
    target_origin_id           = "balanceador"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.cache_desactivada
    origin_request_policy_id   = local.reenviar_todo_al_origen
    response_headers_policy_id = aws_cloudfront_response_headers_policy.seguridad.id
    compress                   = true
  }

  # API REST: pasa por API Gateway, que aplica los límites de tasa por ruta.
  ordered_cache_behavior {
    path_pattern               = "/wp-json/*"
    target_origin_id           = "api"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.cache_desactivada
    origin_request_policy_id   = local.reenviar_todo_al_origen
    response_headers_policy_id = aws_cloudfront_response_headers_policy.seguridad.id
  }

  # Contenido estático: se sirve desde la CDN.
  ordered_cache_behavior {
    path_pattern               = "/wp-content/*"
    target_origin_id           = "balanceador"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.cache_optimizada
    response_headers_policy_id = aws_cloudfront_response_headers_policy.seguridad.id
    compress                   = true
  }

  viewer_certificate {
    acm_certificate_arn      = var.certificado_acm_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  logging_config {
    bucket = aws_s3_bucket.registros.bucket_domain_name
    prefix = "cloudfront/"
  }

  depends_on = [aws_s3_bucket_ownership_controls.registros]
}

# ---------- API Gateway (HTTP API) con integración privada hacia el balanceador

resource "aws_apigatewayv2_api" "tienda" {
  name          = "${local.nombre}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_vpc_link" "tienda" {
  name               = "${local.nombre}-vpc-link"
  subnet_ids         = aws_subnet.app[*].id
  security_group_ids = [aws_security_group.vpc_link.id]
}

resource "aws_apigatewayv2_integration" "balanceador" {
  api_id             = aws_apigatewayv2_api.tienda.id
  integration_type   = "HTTP_PROXY"
  integration_method = "ANY"
  connection_type    = "VPC_LINK"
  connection_id      = aws_apigatewayv2_vpc_link.tienda.id
  integration_uri    = aws_lb_listener.https.arn

  tls_config {
    server_name_to_verify = var.dominio
  }
}

resource "aws_apigatewayv2_route" "rest" {
  #checkov:skip=CKV_AWS_309:La API de la tienda es publica; la autenticacion y la autorizacion por objeto las aplica WordPress (riesgo R02)
  api_id             = aws_apigatewayv2_api.tienda.id
  route_key          = "ANY /wp-json/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.balanceador.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_stage" "produccion" {
  api_id      = aws_apigatewayv2_api.tienda.id
  name        = "$default"
  auto_deploy = true

  # R09: límite de tasa para todas las rutas de la API.
  default_route_settings {
    throttling_rate_limit  = 20
    throttling_burst_limit = 40
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format = jsonencode({
      requestId = "$context.requestId"
      ip        = "$context.identity.sourceIp"
      metodo    = "$context.httpMethod"
      ruta      = "$context.path"
      estado    = "$context.status"
      fecha     = "$context.requestTime"
    })
  }
}
