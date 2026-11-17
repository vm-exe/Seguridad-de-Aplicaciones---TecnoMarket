# Microsegmentación (Zero Trust en red):
#   Internet --443--> ALB --3000--> ECS app --3306--> RDS
# No existe ninguna regla para el puerto 22 ni acceso administrativo directo.

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "ALB publico: solo HTTPS (y HTTP para redireccion)"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  #checkov:skip=CKV_AWS_260:ALB publico de comercio electronico, debe aceptar HTTPS desde Internet; protegido por WAF
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS desde Internet"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  #checkov:skip=CKV_AWS_260:Puerto 80 solo devuelve redireccion 301 a HTTPS
  security_group_id = aws_security_group.alb.id
  description       = "HTTP desde Internet (solo redireccion a HTTPS)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "ALB hacia tareas de la app"
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "app" {
  name        = "${local.name}-app"
  description = "Tareas ECS de la aplicacion"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-app" }
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "Solo desde el ALB"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "app_to_db" {
  security_group_id            = aws_security_group.app.id
  description                  = "App hacia RDS MySQL"
  referenced_security_group_id = aws_security_group.db.id
  from_port                    = 3306
  to_port                      = 3306
  ip_protocol                  = "tcp"
}

# Trivy AVD-AWS-0104 aceptado: la app necesita salir por 443 a servicios con IPs
# variables (PayPal API, HIBP, APIs de AWS). Limitado al puerto 443 y vía NAT.
# Mejora futura: proxy de salida con lista blanca de dominios (AWS Network Firewall).
#trivy:ignore:AVD-AWS-0104
resource "aws_vpc_security_group_egress_rule" "app_https_out" {
  security_group_id = aws_security_group.app.id
  description       = "HTTPS saliente (PayPal API, SMTP sobre TLS, AWS APIs, ECR)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# Trivy AVD-AWS-0104 aceptado: SMTP submission (587/STARTTLS) hacia el proveedor de correo.
# Alternativa recomendada: Amazon SES con VPC endpoint para eliminar esta salida.
#trivy:ignore:AVD-AWS-0104
resource "aws_vpc_security_group_egress_rule" "app_smtp_out" {
  security_group_id = aws_security_group.app.id
  description       = "SMTP submission con STARTTLS"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 587
  to_port           = 587
  ip_protocol       = "tcp"
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "RDS MySQL - solo accesible desde la app"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-db" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "MySQL desde la app"
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 3306
  to_port                      = 3306
  ip_protocol                  = "tcp"
}
