# Capa 5 (perímetro): el balanceador solo es alcanzable desde CloudFront y
# desde el VPC Link de API Gateway (ver grupos de seguridad en red.tf).

resource "aws_lb" "tienda" {
  #checkov:skip=CKV2_AWS_28:El WAF se asocia a CloudFront; el grupo de seguridad solo admite trafico de CloudFront y del VPC Link
  name                       = "${local.nombre}-alb"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = aws_subnet.publica[*].id
  security_groups            = [aws_security_group.balanceador.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true

  access_logs {
    bucket  = aws_s3_bucket.registros.id
    prefix  = "alb"
    enabled = true
  }

  depends_on = [aws_s3_bucket_policy.todos]
}

resource "aws_lb_target_group" "wordpress" {
  #checkov:skip=CKV_AWS_378:TLS termina en el balanceador; el tramo hacia los contenedores ocurre dentro de la subred privada
  name        = "${local.nombre}-wordpress"
  port        = 80
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.principal.id

  health_check {
    path                = "/wp-login.php"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.tienda.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificado_acm_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.wordpress.arn
  }
}
