# Application Load Balancer: terminación TLS (1.2/1.3), redirección HTTP->HTTPS,
# descarte de cabeceras inválidas (anti request smuggling) y logs de acceso a S3.

# Trivy AVD-AWS-0053 aceptado: es la tienda pública; el ALB debe ser accesible desde internet.
# Compensado con AWS WAF (waf.tf), TLS 1.2/1.3 y SG que solo admite 80/443.
#trivy:ignore:AVD-AWS-0053
resource "aws_lb" "main" {
  #checkov:skip=CKV2_AWS_76:Log4j cubierto por AWSManagedRulesKnownBadInputsRuleSet (incluye Log4JRCE) en waf.tf
  #checkov:skip=CKV2_AWS_20:La redireccion HTTP->HTTPS se configura en el listener 80
  name                       = "${local.name}-alb"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
  enable_deletion_protection = true
  desync_mitigation_mode     = "strictest"

  access_logs {
    bucket  = aws_s3_bucket.logs.id
    prefix  = "alb"
    enabled = true
  }

  depends_on = [aws_s3_bucket_policy.logs]
}

resource "aws_lb_target_group" "app" {
  name        = "${local.name}-tg"
  port        = 3000
  protocol    = "HTTP" # tráfico interno dentro de la VPC privada
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    # Readiness: incluye la BD. Si RDS no responde, la tarea sale del balanceo (503).
    # El healthCheck de ECS/Docker sigue en liveness (/api/health) para no reiniciar
    # contenedores sanos por una caida de la BD.
    path                = "/api/health?db=1"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  #checkov:skip=CKV_AWS_2:Listener HTTP existe unicamente para redirigir 301 a HTTPS
  #checkov:skip=CKV_AWS_103:No aplica TLS a un listener de redireccion
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
