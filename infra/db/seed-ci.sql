-- Catálogo mínimo para pruebas E2E y DAST en CI (datos ficticios, sin PII).
INSERT INTO configuracion (clave, valor) VALUES
  ('tienda_nombre','Furniture Investment'),('tienda_telefono','+502 2222-3333'),
  ('moneda_simbolo','$'),('moneda_codigo','USD')
ON DUPLICATE KEY UPDATE valor = VALUES(valor);
INSERT INTO categorias (id, nombre, activo) VALUES (25,'COCINA',1),(28,'DORMITORIO',1)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);
INSERT INTO productos (id, nombre, descripcion, detalles, precio, descuento, stock, categoria_id, activo) VALUES
  (603,'Mesa de cocina extensible Gerbera','Mesa extensible para 6 personas.','Madera de pino.',176.00,0,50,25,1),
  (1001,'Mesita de noche Lundgren','Mesita con cajón.','45 x 40 x 55 cm.',110.00,0,50,28,1),
  (1002,'Mesita 3 cajones Juno','Mesita de tres cajones.','Acabado blanco mate.',99.00,17,50,28,1)
ON DUPLICATE KEY UPDATE stock = VALUES(stock);
