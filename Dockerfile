# ── ASES Tournament Manager ───────────────────────────────────────────────────
# Mimics Hostinger shared / cloud hosting: nginx serving static files.
#
# Build:   docker build -t ases-tm .
# Run:     docker run -p 8080:80 ases-tm
# ─────────────────────────────────────────────────────────────────────────────

FROM nginx:1.27-alpine

LABEL maintainer="ASES Tournament Manager"
LABEL description="Static site served by nginx — mirrors Hostinger nginx hosting"

# ── Copy application files ────────────────────────────────────────────────────
COPY index.html       /usr/share/nginx/html/index.html
COPY css/             /usr/share/nginx/html/css/
COPY js/              /usr/share/nginx/html/js/
COPY images/          /usr/share/nginx/html/images/
COPY app.db           /usr/share/nginx/html/app.db

# ── Nginx configuration ───────────────────────────────────────────────────────
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP (Hostinger maps this to 80/443 in production)
EXPOSE 80
