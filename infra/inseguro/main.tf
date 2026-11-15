# TecnoMarket GT - infraestructura cloud, VERSIÓN INICIAL CON ERRORES DELIBERADOS.
#
# Este archivo NO debe aplicarse en una cuenta real. Existe para producir la
# evidencia del "antes" con Checkov (riesgos R08, R12 y R13 del informe):
#   checkov -d infra/inseguro --framework terraform
#
# Cada bloque marcado con ERROR contiene una configuración insegura intencional.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_vpc" "principal" {
  cidr_block = "10.20.0.0/16"
}

resource "aws_subnet" "publica_a" {
  vpc_id                  = aws_vpc.principal.id
  cidr_block              = "10.20.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true # ERROR: toda instancia recibe IP pública
}

resource "aws_subnet" "publica_b" {
  vpc_id                  = aws_vpc.principal.id
  cidr_block              = "10.20.2.0/24"
  availability_zone       = "us-east-1b"
  map_public_ip_on_launch = true
}

# ERROR (R12): SSH y MariaDB abiertos a todo Internet.
resource "aws_security_group" "tienda" {
  name   = "tmgt-tienda"
  vpc_id = aws_vpc.principal.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 3306
    to_port     = 3306
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "datos" {
  name       = "tmgt-datos"
  subnet_ids = [aws_subnet.publica_a.id, aws_subnet.publica_b.id]
}

# ERROR (R08, R12, R13): contraseña en el código, sin cifrado, con acceso público,
# sin respaldos y en una sola zona de disponibilidad.
resource "aws_db_instance" "tienda" {
  identifier              = "tmgt-mariadb"
  engine                  = "mariadb"
  engine_version          = "11.4"
  instance_class          = "db.t3.micro"
  allocated_storage       = 20
  db_name                 = "tecnomarket"
  username                = "admin"
  password                = "TecnoMarket2026!"
  publicly_accessible     = true
  storage_encrypted       = false
  backup_retention_period = 0
  skip_final_snapshot     = true
  db_subnet_group_name    = aws_db_subnet_group.datos.name
  vpc_security_group_ids  = [aws_security_group.tienda.id]
}

# ERROR (R13): bucket de medios y respaldos sin bloqueo de acceso público,
# sin cifrado y sin versionado.
resource "aws_s3_bucket" "medios" {
  bucket = "tmgt-medios-y-respaldos"
}

resource "aws_s3_bucket_public_access_block" "medios" {
  bucket                  = aws_s3_bucket.medios.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

# ERROR (R13): política con comodines en acciones y recursos.
resource "aws_iam_role" "tarea" {
  name = "tmgt-tarea"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "tarea" {
  name = "tmgt-tarea-todo"
  role = aws_iam_role.tarea.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "*"
      Resource = "*"
    }]
  })
}

resource "aws_ecs_cluster" "tienda" {
  name = "tmgt"
}

resource "aws_cloudwatch_log_group" "tienda" {
  name = "/tmgt/wordpress"
}

# ERROR (R08, R11): secreto en una variable de entorno en texto plano,
# contenedor privilegiado y con IP pública.
resource "aws_ecs_task_definition" "wordpress" {
  family                   = "tmgt-wordpress"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.tarea.arn
  task_role_arn            = aws_iam_role.tarea.arn

  container_definitions = jsonencode([{
    name         = "wordpress"
    image        = "wordpress:latest"
    essential    = true
    portMappings = [{ containerPort = 80 }]
    environment = [
      { name = "WORDPRESS_DB_HOST", value = aws_db_instance.tienda.address },
      { name = "WORDPRESS_DB_USER", value = "admin" },
      { name = "WORDPRESS_DB_PASSWORD", value = "TecnoMarket2026!" }
    ]
  }])
}

resource "aws_ecs_service" "wordpress" {
  name            = "tmgt-wordpress"
  cluster         = aws_ecs_cluster.tienda.id
  task_definition = aws_ecs_task_definition.wordpress.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.publica_a.id, aws_subnet.publica_b.id]
    security_groups  = [aws_security_group.tienda.id]
    assign_public_ip = true
  }
}

# ERROR: balanceador sin HTTPS, sin registros y sin WAF.
resource "aws_lb" "tienda" {
  name               = "tmgt-alb"
  load_balancer_type = "application"
  subnets            = [aws_subnet.publica_a.id, aws_subnet.publica_b.id]
  security_groups    = [aws_security_group.tienda.id]
}

resource "aws_lb_target_group" "wordpress" {
  name        = "tmgt-wordpress"
  port        = 80
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.tienda.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.wordpress.arn
  }
}
