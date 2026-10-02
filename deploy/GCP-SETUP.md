# Migrar Elara a Google Cloud (VM gratis e2-micro, 24/7)

Fly.io en trial apaga la máquina a los 5 minutos. Google Cloud tiene una VM
**"Always Free"** que corre 24/7 **sin vencimiento**: la `e2-micro` (1 GB RAM,
sobra para el bot). La tarjeta se pide **solo para verificar identidad** —
la VM free no genera cargos (y además te dan USD 300 de crédito para probar).

## Qué vamos a instalar

- VM `e2-micro` — **Always Free**, 24/7, no vence
- Ubuntu 22.04 LTS
- Node 22 + ffmpeg (los instala solo el script `gcp-setup.sh`)

---

## 1. Crear la cuenta de Google Cloud (navegador, ~10 min)

1. Entrá a <https://cloud.google.com/free> → **Start free**.
2. Iniciá sesión con tu cuenta de Google y completá los datos con tu tarjeta
   (es verificación de identidad, **no se cobra nada** por la VM free).
3. Listo — la consola está en <https://console.cloud.google.com>.

> 💡 Se registra con una cuenta de Google normal (la de Gmail). Si la página
> falla, probá con otro navegador o modo incógnito.

## 2. Crear la VM gratis (consola web)

1. Menú ☰ → **Compute Engine → VM instances** → **Create instance**
   (la primera vez te pide habilitar la API: **Enable** y esperar ~1 min).
2. Configuración:
   - **Name**: `elara`
   - **Region**: `us-east1 (South Carolina)` o `us-central1 (Iowa)` —
     ⚠️ son las únicas regiones con la e2-micro en "Always Free"
   - **Machine type**: `e2-micro` (2 vCPU compartidas, 1 GB RAM)
   - **Boot disk**: click **Change** → *Ubuntu 22.04 LTS* → **Standard** 10 GB → OK
3. Panel izquierdo: **Security** → pestaña **SSH keys** → **Add item** y pegá
   la clave pública que está en tu compu (mirá abajo 👇).
4. **Create**. En ~30 segundos la VM aparece con su **External IP**. Anotala.

> 🔑 La clave pública ya la generamos en tu compu. Para verla de nuevo:
> ```bash
> cat ~/.ssh/gcp_elara.pub
> ```
> Es la línea `ssh-ed25519 AAAA... ubuntu` (el comentario `ubuntu` es clave:
> hace que el usuario SSH sea `ubuntu` automáticamente).

## 3. Startup script (instala todo solo en el primer arranque)

1. En la misma página de creación, panel izquierdo: **Management** →
   sección **Automation** → campo **Startup script**.
2. Pegá el contenido completo de `deploy/gcp-setup.sh` de este repo.

   Si ya creaste la VM sin el script, también sirve: la e2-micro ejecuta el
   startup script en el próximo reinicio. O corrélo a mano:
   ```bash
   ssh -i ~/.ssh/gcp_elara ubuntu@LA_IP 'sudo bash -s' < deploy/gcp-setup.sh
   ```

## 4. Entrar por SSH y terminar el deploy

El script tarda ~3-5 min (instala Node, ffmpeg, clona, compila). Podés mirar
el progreso con:

```bash
ssh -i ~/.ssh/gcp_elara ubuntu@LA_IP tail -f /var/log/elara-setup.log
```

Cuando diga `Setup de Elara: terminado`, cargá las claves del bot (esto va
desde tu compu, con tu IP real):

```bash
scp -i ~/.ssh/gcp_elara .env ubuntu@LA_IP:/tmp/elara.env
ssh -i ~/.ssh/gcp_elara ubuntu@LA_IP 'sudo bash -s' < deploy/vm-setup.sh
```

Ese segundo script instala el `.env`, compila lo que falte, crea el servicio
`systemd` y **arranca Elara** mostrándote los logs al final. Deberías ver:

```
✅ Elara corriendo. Logs: journalctl -u elara -f
🤖 Elara está en Telegram como @Elara1238_bot.
```

Escribile por Telegram para confirmar. 🎉

---

## Chuleta diaria

| Qué                  | Comando                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| Ver logs en vivo     | `ssh -i ~/.ssh/gcp_elara ubuntu@IP journalctl -u elara -f`              |
| Reiniciar el bot     | `ssh -i ~/.ssh/gcp_elara ubuntu@IP sudo systemctl restart elara`        |
| Estado de la VM      | consola GCP → Compute Engine (o `gcloud compute instances list`)        |
| Actualizar el código | `ssh -i ~/.ssh/gcp_elara ubuntu@IP 'cd /opt/elara && sudo git pull && sudo npm install && sudo npm run build && sudo systemctl restart elara'` |

> ⚠️ La VM free tiene 30 GB de disco estándar gratis. **No la apagues desde la
> consola** pensando que "ahorra" — en free tier da igual, y al apagarla
> tendrías que volver a prenderla para que Elara responda.

## Si algo falla

- **No puedo entrar por SSH** → revisá que pegaste la clave en la VM
  (paso 3.3) y que el usuario final de la clave es `ubuntu`.
- **El bot no arranca** → casi siempre falta el `.env`. Corré el
  `deploy/vm-setup.sh` de nuevo (es idempotente, no rompe nada).
- **No hay notas de voz** → `ssh … 'ffmpeg -version'` (el setup lo instala,
  pero por si acaso).
- **"External IP" desapareció** → si paraste la VM, al prenderla puede cambiar
  la IP efímera. No pasa nada: usá la nueva IP.
