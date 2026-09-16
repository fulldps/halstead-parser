import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import './App.css';
import { DerivedMetrics } from './components/DerivedMetrics.tsx';
import { MetricsTable } from './components/MetricsTable.tsx';
import { TokenTable } from './components/TokenTable.tsx';
import { runAnalysis, type AnalysisResult } from './halstead/index.ts';
import { SAMPLE } from './sample.ts';

interface Analyzed {
  source: string; // какой именно текст посчитан — чтобы заметить, что его потом изменили
  result: AnalysisResult;
}

function App() {
  const [source, setSource] = useState(SAMPLE);
  const [analyzed, setAnalyzed] = useState<Analyzed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTokens, setShowTokens] = useState(false);

  // Результат расчёта — это состояние: React перерисует экран только после setState.
  const analyze = () => {
    try {
      setAnalyzed({ source, result: runAnalysis(source) });
      setError(null);
    } catch (e) {
      setAnalyzed(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    // currentTarget React обнуляет после обработчика, поэтому берём его до await.
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setSource(await file.text());
    setAnalyzed(null);
    setError(null);
    input.value = ''; // иначе повторный выбор того же файла не вызовет onChange
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      analyze();
    }
  };

  const stale = analyzed !== null && analyzed.source !== source;

  return (
    <main className="app">
      <header className="app-header">
        <h1>Метрики Холстеда</h1>
        <p>Анализ исходного кода на Python: 6 базовых и 3 расширенные метрики</p>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2>Исходный код</h2>
          <div className="actions">
            <label className="button secondary">
              Открыть .py
              <input
                className="visually-hidden"
                type="file"
                accept=".py,text/x-python,text/plain"
                onChange={handleFile}
              />
            </label>
            <button type="button" className="secondary" onClick={() => setSource(SAMPLE)}>
              Пример из методички
            </button>
            <button type="button" className="secondary" onClick={() => setSource('')}>
              Очистить
            </button>
          </div>
        </div>

        <textarea
          className="editor"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          placeholder="Вставьте код на Python или откройте файл…"
          aria-label="Исходный код на Python"
        />

        <div className="panel-foot">
          <button type="button" onClick={analyze}>
            Рассчитать
          </button>
          <span className="hint">⌘/Ctrl + Enter</span>
          {stale && <span className="stale">Код изменён — результаты ниже устарели</span>}
        </div>
      </section>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {analyzed !== null && (
        <>
          <div className="results">
            <section className="panel">
              <h2>Базовые метрики</h2>
              <MetricsTable metrics={analyzed.result.metrics} />
            </section>
            <section className="panel">
              <h2>Расширенные метрики</h2>
              <DerivedMetrics metrics={analyzed.result.metrics} />
            </section>
          </div>

          <section className="panel">
            <label className="toggle">
              <input
                type="checkbox"
                checked={showTokens}
                onChange={(e) => setShowTokens(e.target.checked)}
              />
              Показать разметку лексем
            </label>
            {showTokens && <TokenTable items={analyzed.result.items} />}
          </section>
        </>
      )}
    </main>
  );
}

export default App;
