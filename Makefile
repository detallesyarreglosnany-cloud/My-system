# Atajos para operar el sistema. Requiere Docker con el plugin compose.
.PHONY: ayuda instalar dev construir arrancar detener reiniciar semilla migrar registro respaldo pruebas limpiar

ayuda:
	@echo "make instalar   · instala dependencias de desarrollo"
	@echo "make dev        · API y frontend en modo desarrollo"
	@echo "make arrancar   · levanta todo con Docker (produccion)"
	@echo "make semilla    · carga organizacion, usuario admin y datos de ejemplo"
	@echo "make registro   · muestra los logs en vivo"
	@echo "make respaldo   · genera un respaldo comprimido de la base"
	@echo "make pruebas    · ejecuta la bateria de pruebas de la API"
	@echo "make detener    · apaga los contenedores"

instalar:
	npm install

dev:
	npm run dev

construir:
	docker compose build

arrancar:
	docker compose up -d --build
	@echo "Listo. Abre http://localhost:$${WEB_PORT:-8080}"

detener:
	docker compose down

reiniciar:
	docker compose restart app

semilla:
	docker compose run --rm app npm run seed:prod

migrar:
	docker compose run --rm app npm run migrate:prod

registro:
	docker compose logs -f app

respaldo:
	./deploy/respaldo.sh

pruebas:
	npm run test --workspace=apps/api

limpiar:
	docker compose down -v
