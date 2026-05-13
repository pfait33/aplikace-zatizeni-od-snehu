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
    <main className="app-shell">
      <section className="intro">
        <div>
          <p className="eyebrow">Orientační technická pomůcka</p>
          <h1>Zatížení sněhem podle parcely</h1>
        </div>
      </section>

      <section className="workspace">
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
          <div className="message error">
            <AlertTriangle size={20} />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <ResultPanel result={result} />
        )}
      </section>
    </main>
  );
}

function ResultPanel({ result }: { result: SnowLoadResponse }) {
  return (
    <section className="result-panel">
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
