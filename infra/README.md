# Infraestructura como código de TecnoMarket GT

Arquitectura cloud objetivo de la sección 1.4 del informe, descrita en Terraform sobre
AWS. Estos archivos **no se aplican** en una cuenta real durante el proyecto: sirven
para auditar la configuración con Checkov (fase 5 del enunciado, riesgos R08, R12 y R13).

| Carpeta     | Contenido                                                | Resultado de Checkov 3.4.5                 |
|-------------|----------------------------------------------------------|--------------------------------------------|
| `inseguro/` | Versión inicial con errores deliberados (un archivo)     | 25 superadas, 53 fallidas                  |
| `seguro/`   | Versión corregida, dividida por capa                     | 399 superadas, 0 fallidas, 30 excepciones  |

Ambas versiones superan `terraform validate` (comprobado con OpenTofu 1.8.5 y el
proveedor de AWS 5.70.0). Los reportes de la carpeta `reportes/` son la salida real de
Checkov sobre estos archivos; para el informe, vuelvan a ejecutarlo en su equipo y
capturen su propia evidencia con fecha y versión.

## Cómo generar la evidencia (Anexo E)

```sh
pip install checkov

# Antes de las correcciones
checkov -d infra/inseguro --framework terraform --compact

# Después de las correcciones
checkov -d infra/seguro --framework terraform --compact

# Secretos en el código (detecta la contraseña escrita en inseguro/main.tf)
checkov -d infra/inseguro --framework secrets
```

Para comprobar la sintaxis (opcional, requiere Terraform y descarga el proveedor de AWS):

```sh
cd infra/seguro && terraform init -backend=false && terraform validate
```

## Archivos de la versión corregida

| Archivo             | Contenido                                                        | Capa del informe |
|---------------------|------------------------------------------------------------------|------------------|
| `versiones.tf`      | Proveedor, región y etiquetas                                    | —                |
| `variables.tf`      | Dominio, certificado, imagen por digest, repositorio autorizado  | —                |
| `red.tf`            | VPC, subredes en tres niveles, NAT y grupos de seguridad         | 4 y 5            |
| `llaves.tf`         | Llaves KMS separadas por tipo de dato, con rotación              | 1                |
| `datos.tf`          | RDS para MariaDB cifrado, en dos zonas, sin acceso público       | 1 y 4            |
| `almacenamiento.tf` | Buckets de medios, respaldos y registros                         | 1                |
| `identidad.tf`      | Roles IAM de mínimo privilegio, OIDC del pipeline y Cognito      | 7                |
| `contenedores.tf`   | Registro de imágenes y servicio en ECS con Fargate               | 2c y 3           |
| `balanceador.tf`    | Balanceador con TLS 1.3                                          | 5                |
| `perimetro.tf`      | AWS WAF, CloudFront y API Gateway                                | 5                |
| `registros.tf`      | Grupos de registros cifrados con retención de 180 días           | 7                |

## Errores deliberados de la versión insegura

| Error                                                        | Riesgo   | Corrección en `seguro/`                                   |
|--------------------------------------------------------------|----------|-----------------------------------------------------------|
| Puertos 22 y 3306 abiertos a 0.0.0.0/0                       | R12      | Reglas entre grupos de seguridad, sin SSH                 |
| Base de datos con acceso público, sin cifrado ni respaldos   | R12, R13 | Subred de datos sin ruta a Internet, KMS, dos zonas       |
| Contraseña escrita en el código y en la tarea                | R08      | Contraseña administrada por RDS y Secrets Manager         |
| Bucket sin bloqueo de acceso público, cifrado ni versionado  | R13      | Bloqueo total, SSE-KMS, versionado y solo TLS             |
| Política IAM con `Action: *` y `Resource: *`                 | R13      | Un rol por función con acciones y recursos concretos      |
| Mismo rol para ejecución y tarea; IP pública; imagen `latest`| R07, R11 | Roles separados, subred privada, imagen por digest        |
| Balanceador solo con HTTP, sin registros                     | R09      | HTTPS con TLS 1.3, registros de acceso, CloudFront y WAF  |

## Excepciones documentadas (30)

Cada excepción está anotada en el propio archivo con `#checkov:skip=ID:justificación`,
de modo que queda versionada. Se agrupan en doce motivos:

| Comprobación                         | Motivo                                                                                   |
|--------------------------------------|------------------------------------------------------------------------------------------|
| CKV_AWS_109, 111 y 356 (llaves KMS)  | En una política de llave, el recurso `*` es la propia llave                              |
| CKV_AWS_338 (registros)              | La política del informe fija 180 días de retención, no 365                               |
| CKV_AWS_144 (buckets)                | Sin réplica entre regiones; en respaldos está **pendiente** (R14)                        |
| CKV2_AWS_62 (buckets)                | No se requieren notificaciones de eventos                                                |
| CKV_AWS_145 y CKV_AWS_18 (registros) | Los registros del balanceador solo admiten SSE-S3; es el bucket de destino de registros  |
| CKV2_AWS_65 (registros)              | Los registros estándar de CloudFront requieren ACL en el bucket                          |
| CKV2_AWS_57 (secreto de aplicación)  | La rotación de la cuenta `tmgt_app` requiere una función Lambda, **pendiente**           |
| CKV_AWS_336 (tarea de ECS)           | WordPress escribe en su directorio de medios                                             |
| CKV2_AWS_28 y CKV_AWS_378 (balanceador) | El WAF va en CloudFront; TLS termina en el balanceador                                |
| CKV_AWS_260 (grupo de seguridad)     | Falso positivo: el origen es otro grupo de seguridad                                     |
| CKV_AWS_374, 310, CKV2_AWS_42, 46 y 47 (CloudFront) | Sin restricción geográfica ni origen de respaldo; sin lista de IP anónimas |
| CKV_AWS_309 (API Gateway)            | API pública; la autorización por objeto la aplica WordPress (R02)                        |

## Limitaciones

- El análisis es estático: confirma lo que el código declara, no lo que una
  infraestructura desplegada conserva.
- La copia de respaldos a una segunda región y la rotación de la cuenta de aplicación
  no están implementadas; el informe debe reflejarlas como pendientes.
- El valor del secreto `tmgt/db/app` y el certificado de ACM se crean fuera de Terraform.
