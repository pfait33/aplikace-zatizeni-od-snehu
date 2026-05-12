# Zatížení sněhem podle parcely v ČR

Webová aplikace pro orientační zjištění charakteristického zatížení sněhem na zemi podle katastrálního území a parcelního čísla.

> Výsledek není autorizované statické posouzení. Pro projektovou dokumentaci je nutné hodnotu ověřit podle platné normy a oficiální mapy ČHMÚ.

## Spuštění

```bash
npm install
npm run install:all
npm run dev
```

Ve Windows PowerShellu může být potřeba použít `npm.cmd`:

```powershell
npm.cmd install
npm.cmd run install:all
npm.cmd run dev
```

Backend běží na `http://localhost:3001`, frontend na `http://localhost:5173`.

## GitHub Pages

GitHub Pages hostuje pouze statický frontend. Express backend je nutné provozovat zvlášť na veřejné adrese, například Render, Railway nebo Fly.io.

Workflow `.github/workflows/pages.yml` publikuje složku `frontend/dist` na Pages. Pro funkční veřejnou verzi nastavte v GitHub repozitáři proměnnou:

```text
VITE_API_BASE_URL=https://vase-verejne-api.example.com
```

Bez této proměnné se frontend na GitHub Pages otevře, ale API dotazy na `/api/snow-load` nebudou mít backend.

## Backend deploy

Soubor `render.yaml` připravuje backend jako Render Web Service.

Po nasazení backendu nastavte v GitHub repozitáři proměnnou `VITE_API_BASE_URL` na veřejnou URL backendu, například:

```text
https://aplikace-zatizeni-od-snehu-api.onrender.com
```

## Lokální ověření

```bash
npm run build
npm run test:api
```

PowerShell:

```powershell
npm.cmd run build
npm.cmd run test:api
```

## Ukázkový dotaz

```text
Katastrální území: Kvaň
Parcelní číslo: 223/2
```

```text
GET http://localhost:3001/api/snow-load?ku=Kva%C5%88&parcel=223%2F2
```

## Data pro celou ČR

Aplikace umí online najít parcelu v ČÚZK CPX WFS a online dopočítat sněhové zatížení z GPS souřadnic parcely přes digitální sněhovou mapu `clima-maps.info/snehovamapa/getData.php`.

Lokální CSV soubory slouží jako fallback, pokud online služby nejsou dostupné.

Online zdroje:

1. ČÚZK CPX WFS: `GetZoningByName` a `GetParcel`.
2. Digitální sněhová mapa: `getData.php`.
3. Open-Meteo elevation API.

### Index parcel

Online ČÚZK je zapnutý ve výchozím nastavení. Vypnutí:

```powershell
$env:CADASTRAL_ONLINE_ENABLED="false"
```

Lokální fallback soubor je `backend/data/parcels.sample.csv`. Pro vlastní lokální fallback nastavte:

```powershell
$env:CADASTRAL_INDEX_PATH="C:\data\parcels-cr.csv"
```

CSV sloupce:

```text
kuName,kuCode,parcelId,parcelNumber,lat,lon,x,y,source
```

Stačí vyplnit buď `lat/lon` ve WGS84, nebo `x/y` v S-JTSK EPSG:5514. Pokud existuje polygon, připravte do indexu definiční bod nebo centroid polygonu.

### Grid sněhového zatížení

Online dotaz je zapnutý ve výchozím nastavení. Vypnutí:

```powershell
$env:SNOW_LOAD_ONLINE_ENABLED="false"
```

Změna URL online adaptéru:

```powershell
$env:SNOW_LOAD_ONLINE_URL="https://clima-maps.info/snehovamapa/getData.php"
```

Lokální fallback soubor je `backend/data/snow-load-grid.sample.csv`. Pro produkční fallback nastavte:

```powershell
$env:SNOW_LOAD_GRID_PATH="C:\data\snow-load-grid-cr.csv"
```

CSV sloupce:

```text
lat,lon,sk,source
```

Backend hledá nejbližší buňku gridu do `100 m`. Limit lze změnit:

```powershell
$env:SNOW_GRID_MAX_DISTANCE_METERS="100"
```

### Nadmořská výška

Výchozí online zdroj je:

```text
https://api.open-meteo.com/v1/elevation?latitude={lat}&longitude={lon}
```

Vypnutí online výškové služby:

```powershell
$env:ELEVATION_ONLINE_ENABLED="false"
```

Lokální DEM CSV:

```powershell
$env:ELEVATION_GRID_PATH="C:\data\elevation-grid-cr.csv"
```

CSV sloupce:

```text
lat,lon,elevation,source
```

Nebo externí API s šablonou:

```powershell
$env:ELEVATION_API_URL="https://example.com/elevation?lat={lat}&lon={lon}"
```

Podporovaný tvar odpovědi je buď `{ "elevation": 455 }`, nebo `{ "results": [{ "elevation": 455 }] }`.

## Zdroje dat

- ČÚZK publikuje INSPIRE Cadastral Parcels WFS a předpřipravené GML soubory pro katastrální parcely.
- Dokumentace digitální sněhové mapy popisuje grid 100 x 100 m s charakteristickou hodnotou zatížení sněhem na zemi `sk`.
- Online sněhový adaptér používá formulářový endpoint `getData.php`, který používá i veřejná aplikace digitální sněhové mapy. HTML scraping není použitý.
