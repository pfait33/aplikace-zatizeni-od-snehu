import { FormEvent, useState } from "react";
import axios from "axios";
import { AlertTriangle, ExternalLink, Loader2, MapPin, Search } from "lucide-react";

type SnowLoadResponse = {
  input: {
    ku: string;
    parcel: string;
  };
  parcel: {
    kuCode: string;
    parcelId: string;
    parcelNumber: string;
  };
  location: {
    lat: number;
    lon: number;
    source: string;
    cadastralMapUrl: string;
    mapyComUrl: string;
    chmiSnowMapUrl: string;
  };
  altitude: {
    value: number | null;
    unit: string;
    source: string;
  };
  snowLoad: {
    sk: number | null;
    unit: string;
    source: string;
  };
  snowArea: {
    code: string | null;
    limit: number | null;
    unit: string;
    source: string;
  };
  warnings: string[];
};

type ApiError = {
  error: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? "" : "http://localhost:3001");
const apiUrl = `${apiBaseUrl}/api/snow-load`;

export function App() {
  const [ku, setKu] = useState("Kvaň");
  const [parcel, setParcel] = useState("223/2");
  const [result, setResult] = useState<SnowLoadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await axios.get<SnowLoadResponse>(apiUrl, {
        params: { ku, parcel }
      });
      setResult(response.data);
    } catch (requestError) {
      if (axios.isAxiosError<ApiError>(requestError)) {
        setError(requestError.response?.data?.error ?? "Nepodařilo se získat výsledek.");
      } else {
        setError("Nepodařilo se získat výsledek.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell" data-design="cag-workbench">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">SNÍH</div>
        <div>
          <p className="eyebrow">Technická pomůcka</p>
          <h1>Aplikace zatížení od sněhu</h1>
        </div>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Orientační výpočet pro Českou republiku</p>
        <h2 id="page-title">Zatížení sněhem <span>podle parcely</span></h2>
        <p className="lede">Zadejte katastrální území a parcelní číslo. Aplikace dohledá polohu a vrátí charakteristické zatížení sněhem, sněhovou oblast i nadmořskou výšku.</p>
      </section>

      <section className="workspace" aria-label="Výpočet zatížení sněhem">
        <div className="card query-card">
          <form className="query-form" onSubmit={handleSubmit}>
            <label>
              <span>Katastrální území</span>
              <input value={ku} onChange={(event) => setKu(event.target.value)} placeholder="např. Kvaň" />
            </label>

            <label>
              <span>Parcelní číslo</span>
              <input value={parcel} onChange={(event) => setParcel(event.target.value)} placeholder="např. 223/2" />
            </label>

            <button type="submit" disabled={loading}>
              {loading ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
              Zjistit zatížení sněhem
            </button>
          </form>

          {error && (
            <div className="message error" role="alert">
              <AlertTriangle size={20} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {result && <ResultPanel result={result} />}
      </section>

      <section className="steps" aria-label="Jak výpočet funguje">
        <div><span>01</span><strong>Zadejte parcelu</strong><p>Vyplňte název katastrálního území a parcelní číslo.</p></div>
        <div><span>02</span><strong>Dohledáme polohu</strong><p>Souřadnice parcely ověříme vůči dostupným mapovým podkladům.</p></div>
        <div><span>03</span><strong>Získáte hodnoty</strong><p>Výsledek zobrazí sk, sněhovou oblast a nadmořskou výšku.</p></div>
      </section>

      <footer>
        <span>Aplikace zatížení od sněhu</span>
        <span>Orientační výpočet · hodnotu ověřte podle platné normy</span>
      </footer>
    </main>
  );
}

function ResultPanel({ result }: { result: SnowLoadResponse }) {
  return (
    <section className="card result-panel" aria-live="polite">
      <div className="result-heading">
        <MapPin size={22} />
        <div>
          <h2>Nalezená parcela</h2>
          <p>{result.input.ku}, parcela {result.parcel.parcelNumber}</p>
        </div>
      </div>

      <div className="result-grid">
        <DataItem label="Kód k. ú." value={result.parcel.kuCode} />
        <DataItem label="ID parcely" value={result.parcel.parcelId} />
        <DataItem label="GPS lat" value={result.location.lat.toFixed(6)} />
        <DataItem label="GPS lon" value={result.location.lon.toFixed(6)} />
        <DataItem label="Nadmořská výška" value={result.altitude.value === null ? "Nedostupná" : `${result.altitude.value} ${result.altitude.unit}`} />
        <DataItem label="Sněhové zatížení sk" value={result.snowLoad.sk === null ? "Nedostupné" : `${result.snowLoad.sk.toFixed(2)} ${result.snowLoad.unit}`} strong />
        <DataItem label="Sněhová oblast" value={formatSnowArea(result)} strong />
      </div>

      <div className="map-links">
        <a href={result.location.cadastralMapUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={18} />
          Detail parcely v katastru
        </a>
        <a href={result.location.mapyComUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={18} />
          Mapy.com
        </a>
        <a href={result.location.chmiSnowMapUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={18} />
          Sněhová mapa ČHMÚ
        </a>
      </div>
    </section>
  );
}

function DataItem({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "data-item strong" : "data-item"}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function formatSnowArea(result: SnowLoadResponse): string {
  if (!result.snowArea.code) {
    return "Nedostupná";
  }

  if (result.snowArea.limit === null) {
    return `${result.snowArea.code} (> 4.0 ${result.snowArea.unit})`;
  }

  return `${result.snowArea.code} (do ${result.snowArea.limit.toFixed(1)} ${result.snowArea.unit})`;
}
