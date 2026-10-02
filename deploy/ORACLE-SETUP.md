# Migrar Elara de Fly.io → Oracle Cloud (Always Free)

Fly.io en trial apaga la máquina a los 5 minutos. Oracle Cloud Always Free no:
te da una VM corriendo 24/7 gratis. La tarjeta se usa **solo para verificar
identidad** (la VM free no genera cargos).

## Qué vamos a instalar

- VM `VM.Standard.A1.Flex` — 2 OCPU + 12 GB RAM (**Always Free**, no vence)
- Ubuntu 22.04 (o 24.04) mínimo
- Node 22 + ffmpeg (los instala solo el script `oracle-cloud-init.yaml`)

---

## 1. Crear la cuenta Oracle (navegador, ~10 min)

1. Entrá a <https://www.oracle.com/cloud/free/> → **Start for free**.
2. Completá los datos. Te pide tarjeta: **no te cobra nada**, es verificación
   de identidad (hacen una retención temporal que se devuelve).
3. Elegí tu **Home Region**: `Brazil East (Sao Paulo)` o `US East (Ashburn)`
   funcionan bien desde Argentina. ⚠️ Después no se puede cambiar.
4. Terminá el registro y esperá el mail de bienvenida (puede tardar un rato).

## 2. Crear la VM gratis (consola Oracle)

1. En el menú de la consola: **Compute → Instances → Create Instance**.
2. Nombre: `elara`.
3. **Image**: Ubuntu 22.04 (o 24.04).
4. **Shape**: click en *Change shape* → **Ampere** → `VM.Standard.A1.Flex`:
   - OCPUs: `2`
   - Memory: `12 GB`
   - (Si dice que no hay capacidad disponible, probá más tarde u otra región —
     es la queja más común; suele haber en horarios hidrados.)
5. **SSH keys**: elegí *Paste a public key* y pegá la clave pública que está en
   `~/.ssh/oracle_elara.pub` de tu compu (ya la generamos, son los pasos de abajo).
6. **Boot volume**: 50 GB está bien (default).
7. **Show advanced options → Cloud init script**: pegá el contenido completo de
   `deploy/oracle-cloud-init.yaml` (o en *Management → Paste cloud-init script*).
8. **Create**. Esperá a que el estado sea `RUNNING` (~1 min).
9. Anotale la **Public IP address** que te muestra la página de la instancia.

> 🔑 La clave pública ya está generada en tu compu. Si la necesitás de nuevo:
> ```bash
> cat ~/.ssh/oracle_elara.pub
> ```
> Es una sola línea `ssh-ed25519 AAAA... elara-oracle-vm`.

## 3. Abrir el firewall de la red de Oracle

Por defecto Oracle bloquea todo. Para SSH y acceso básico:

1. Consola → **Networking → Virtual Cloud Networks** → entrá a la VCN de la VM.
2. **Security Lists** → *Default Security List* → **Add Ingress Rule**:
   - Source CIDR: `0.0.0.0/0`
   - Protocol: `TCP`, Destination Port: `22` (SSH)

> El bot usa **salida** a internet (Telegram, Groq, ElevenLabs), que ya viene
> abierta. No hace falta abrir puertos para el bot en sí (usa long-polling).

## 4. Entrar por SSH

```bash
ssh -i ~/.ssh/oracle_elara ubuntu@LA_IP_PUBLICA
```

La primera vez que entres, el cloud-init puede seguir instalando Node/ffmpeg.
Podés mirar el progreso con:

```bash
tail -f /var/log/cloud-init-output.log
```

Cuando termine va a decir `The system is finally up`.

## 5. Cargar las claves de Elara

En tu compu local (no en la VM) corré esto para copiar el `.env` con las claves
del bot (Telegram, Groq, ElevenLabs) a la VM:

```bash
scp -i ~/.ssh/oracle_elara .env ubuntu@LA_IP_PUBLICA:/tmp/elara.env
ssh -i ~/.ssh/oracle_elara ubuntu@LA_IP_PUBLICA "sudo mv /tmp/elara.env /opt/elara/.env && sudo chmod 600 /opt/elara/.env"
```

> ⚠️ El repo en GitHub es público: **el `.env` nunca se sube**, solo se copia
> por SSH. Las claves de Fly.io viven en los secrets de Fly (ya configurados),
> y las de acá viven en `/opt/elara/.env`.

## 6. Arrancar Elara

```bash
ssh -i ~/.ssh/oracle_elara ubuntu@LA_IP_PUBLICA
sudo systemctl enable --now elara
sudo systemctl status elara        # tiene que decir "active (running)"
journalctl -u elara -f             # logs en vivo, debería aparecer "Elara está en Telegram"
```

Escribile a Elara por Telegram para confirmar que responde. 🎉

---

## Mantenimiento diario (chuleta)

| Qué                    | Comando                                                    |
| ---------------------- | ---------------------------------------------------------- |
| Ver logs en vivo       | `ssh -i ~/.ssh/oracle_elara ubuntu@IP` → `journalctl -u elara -f` |
| Reiniciar el bot       | `sudo systemctl restart elara`                             |
| Actualizar el código   | `cd /opt/elara && sudo git pull && sudo npm install && sudo npm run build && sudo systemctl restart elara` |
| Ver si la VM corre     | consola Oracle → Compute → Instances (estado `RUNNING`)    |

## Diferencias con Fly.io

- El código ya no se deploya con `fly deploy`: la VM hace `git pull` y reinicia
  el servicio. Si querés deploy automático en cada push, después podemos meter
  un webhook o GitHub Action que haga SSH.
- El `.env` de Fly (secrets) ahora es `/opt/elara/.env` en la VM.
- La VM free tiene 2 OCPU y 12 GB RAM — **más potente** que la de Fly.

## Si algo falla

- `systemctl status elara` muestra el error → casi siempre es `.env` faltante
  o un build viejo.
- El bot no manda notas de voz → verificar `ffmpeg -version` en la VM.
- "Out of capacity" al crear la VM → reintentar más tarde (el free se agota
  por momentos; no es que lo perdiste).
