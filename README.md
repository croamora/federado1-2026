# federado1-2026

Web estática para controlar orden de paso y puntajes del Control 1 Zona Sur - Concepción 2026.

## Funcionalidades

- Datos cargados desde la planilla `final_ORDEN DE PASO CONTROL 1 ZONA SUR - CONCEPCIÓN.xlsx`.
- Separación por sábado, domingo, banca 1 y banca 2.
- Registro sincronizado con Firebase Firestore.
- Marca de `Pasó` por participante.
- Puntaje final destacado.
- Detalle técnico: D, A, E, penalización y notas.
- Ranking por categoría basado en puntaje final.
- Preparada para GitHub Pages.

## Publicación en GitHub Pages

Activar Pages desde `Settings > Pages`, usando `Deploy from a branch`, rama `main`, carpeta `/root`.

## Firebase

Publicar `firestore.rules` en Firestore Rules antes de usar la web en producción.
