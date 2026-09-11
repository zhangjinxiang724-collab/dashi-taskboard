import type { ResearchCompletenessPresentation } from "../researchCompletenessPresentation";

function statusParts(value: string) {
  const match = value.match(/^([✓△×])\s*(.*)$/);
  return match ? { symbol: match[1], text: match[2] } : { symbol: null, text: value };
}

export function ResearchCompletenessPanel({ presentation }: { presentation: ResearchCompletenessPresentation }) {
  const headline = statusParts(presentation.headline);
  return (
    <section className={`research-completeness research-completeness-${presentation.severity}`} aria-label="保存完整性">
      <div className="research-completeness-primary">
        <strong>{headline.symbol ? <span className={`research-completeness-symbol is-${presentation.severity}`}>{headline.symbol}</span> : null}{headline.text}</strong>
        <p>{presentation.messageSummary}</p>
        {presentation.mediaNotice ? <p className="research-completeness-media"><span className="research-completeness-symbol is-warning">△</span>{presentation.mediaNotice}</p> : null}
        {presentation.guidance ? <p className="research-completeness-guidance">{presentation.guidance}</p> : null}
      </div>
      <details className="research-completeness-details">
        <summary>查看保存详情 <span aria-hidden="true">›</span></summary>
        <div className="research-completeness-detail-body">
          <h3>保存详情</h3>
          <div className="research-completeness-rows">
            {presentation.detailRows.map((row) => {
              const status = statusParts(row.status);
              return (
              <div className="research-completeness-row" key={row.label}>
                <div>
                  <strong>{row.label}</strong>
                  <span className="research-completeness-value">{status.symbol ? <span className={`research-completeness-symbol is-${row.severity}`}>{status.symbol}</span> : null}{status.text}</span>
                </div>
                <p>{row.description}</p>
              </div>
              );
            })}
          </div>
          <details className="research-completeness-technical">
            <summary>查看技术信息</summary>
            <dl>
              {presentation.technicalRows.map((row) => (
                <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
              ))}
            </dl>
          </details>
        </div>
      </details>
    </section>
  );
}
