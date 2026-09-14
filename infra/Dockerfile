# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# PocketBase + l'interface d'administration, dans UNE seule image.
#
# Pourquoi pas un second conteneur : PocketBase sert lui-même les fichiers
# statiques déposés dans `--publicDir` (`/pb_public` dans cette image, voir son
# `entrypoint.sh`), pour toute URL qui n'est ni `/api/…` ni `/_/…`. Déposer le
# SPA là revient donc à le publier sur le domaine qui sert DÉJÀ l'API :
#
#   - même origine, donc aucun CORS à ouvrir ;
#   - un seul port, un seul tunnel, une seule entrée à configurer ;
#   - l'application de bureau continue d'utiliser la même URL, inchangée.
#
# Un nginx séparé faisant du reverse-proxy vers PocketBase ferait exactement le
# même travail, avec un conteneur, un réseau et un fichier de configuration en
# plus, et une adresse de plus à tenir à jour.
#
# L'image de base reste ÉPINGLÉE, pour la même raison qu'avant : le script
# `setup-pocketbase.mjs` parle l'API des collections de PocketBase >= 0.23 et le
# SDK JS embarqué vise cette série. Changer cette version, c'est changer les
# deux ensemble — voir infra/README_INFRA.md.
# ---------------------------------------------------------------------------

FROM oven/bun:1.3-alpine AS build

WORKDIR /build

# Les dépendances d'abord, séparément : elles ne changent qu'au gré du
# package.json, et cette couche se garde en cache d'une image à l'autre. Copier
# les sources avant ferait réinstaller tout `node_modules` à chaque virgule
# changée dans un composant.
COPY admin/package.json admin/bun.lock ./admin/
RUN cd admin && bun install --frozen-lockfile

# `src/` est indispensable : l'interface d'administration importe le code PUR de
# l'application de bureau (types des cartes, validation structurelle,
# sérialisation) via son alias `@app`. C'est délibéré — un validateur recopié
# finirait par accepter ce que l'application refuse d'ouvrir.
COPY admin ./admin
COPY src ./src

# `bun run build` = `tsc && vite build` : la compilation ÉCHOUE sur une erreur de
# types. Une image qui se construit quand même sur du code cassé ne rend service
# à personne.
RUN cd admin && bun run build

FROM ghcr.io/muchobien/pocketbase:0.40.3

# Servi à la racine du domaine pour tout ce qui n'est pas `/api/…` ni `/_/…`.
COPY --from=build /build/admin/dist /pb_public
