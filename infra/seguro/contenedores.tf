# Capa 3 (host) y capa 2c (implementación): registro de imágenes y servicio de
# contenedores (riesgos R07, R08 y R11).

resource "aws_ecr_repository" "wordpress" {
  name                 = "${local.nombre}/wordpress"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.datos.arn
  }
}

resource "aws_ecs_cluster" "tienda" {
  name = local.nombre

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "wordpress" {
  #checkov:skip=CKV_AWS_336:WordPress escribe en su directorio de medios y de cache; se compensa negando la ejecucion de PHP en medios
  family                   = "${local.nombre}-wordpress"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_ejecucion.arn
  task_role_arn            = aws_iam_role.ecs_tarea.arn

  container_definitions = jsonencode([{
    name       = "wordpress"
    image      = var.imagen_wordpress # por digest, nunca "latest"
    essential  = true
    privileged = false

    portMappings = [{ containerPort = 80, protocol = "tcp" }]

    environment = [
      { name = "WORDPRESS_DB_HOST", value = aws_db_instance.tienda.address },
      { name = "WORDPRESS_DB_NAME", value = "tecnomarket" },
      { name = "WORDPRESS_DB_USER", value = "tmgt_app" }
    ]

    # El secreto se inyecta en el arranque desde Secrets Manager; no aparece
    # en el código, en la definición de la tarea ni en el estado.
    secrets = [
      { name = "WORDPRESS_DB_PASSWORD", valueFrom = aws_secretsmanager_secret.db_app.arn }
    ]

    linuxParameters = {
      capabilities = {
        drop = ["ALL"]
        add  = ["CHOWN", "DAC_OVERRIDE", "SETGID", "SETUID", "NET_BIND_SERVICE"]
      }
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.wordpress.name
        "awslogs-region"        = "us-east-1"
        "awslogs-stream-prefix" = "wordpress"
      }
    }
  }])
}

resource "aws_ecs_service" "wordpress" {
  name            = "${local.nombre}-wordpress"
  cluster         = aws_ecs_cluster.tienda.id
  task_definition = aws_ecs_task_definition.wordpress.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.app[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.wordpress.arn
    container_name   = "wordpress"
    container_port   = 80
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.https]
}
