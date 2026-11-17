# Monitoreo y detección (SIEM básico en CloudWatch):
#  - Métricas a partir de eventos de auditoría JSON de la app ("type":"audit")
#  - Alarmas: picos de bloqueos WAF, fuerza bruta en login, errores 5xx
#  - Notificación por SNS cifrado

resource "aws_sns_topic" "alarms" {
  name              = "${local.name}-alarmas-seguridad"
  kms_master_key_id = aws_kms_key.main.arn
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# --- Métricas desde logs de auditoría de la aplicación ---
resource "aws_cloudwatch_log_metric_filter" "login_failed" {
  name           = "login-fallido"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "{ $.type = \"audit\" && $.event = \"auth.login.failed\" }"

  metric_transformation {
    name      = "LoginFallido"
    namespace = "${local.name}/Seguridad"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "access_denied" {
  name           = "acceso-denegado"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "{ $.type = \"audit\" && $.event = \"authz.denied\" }"

  metric_transformation {
    name      = "AccesoDenegado"
    namespace = "${local.name}/Seguridad"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "price_mismatch" {
  name           = "pago-monto-inconsistente"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "{ $.type = \"audit\" && $.event = \"payment.amount_mismatch\" }"

  metric_transformation {
    name      = "PagoMontoInconsistente"
    namespace = "${local.name}/Seguridad"
    value     = "1"
  }
}

# --- Alarmas ---
resource "aws_cloudwatch_metric_alarm" "brute_force" {
  alarm_name          = "${local.name}-fuerza-bruta-login"
  alarm_description   = "Mas de 20 logins fallidos en 5 minutos (posible fuerza bruta / credential stuffing)"
  namespace           = "${local.name}/Seguridad"
  metric_name         = "LoginFallido"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 20
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "idor_attempts" {
  alarm_name          = "${local.name}-accesos-denegados"
  alarm_description   = "Picos de accesos denegados (posible enumeracion BOLA/IDOR o escalamiento)"
  namespace           = "${local.name}/Seguridad"
  metric_name         = "AccesoDenegado"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "payment_tampering" {
  alarm_name          = "${local.name}-manipulacion-pago"
  alarm_description   = "Monto capturado distinto al calculado en servidor"
  namespace           = "${local.name}/Seguridad"
  metric_name         = "PagoMontoInconsistente"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "waf_blocks" {
  alarm_name          = "${local.name}-waf-bloqueos"
  alarm_description   = "Pico de peticiones bloqueadas por el WAF (posible ataque o escaneo)"
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 200
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    WebACL = aws_wafv2_web_acl.main.name
    Region = var.region
    Rule   = "ALL"
  }
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.name}-errores-5xx"
  alarm_description   = "Errores 5xx en la aplicacion (disponibilidad / posible DoS)"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 25
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }
}
