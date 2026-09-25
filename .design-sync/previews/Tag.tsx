import { Tag } from "@copilot-cost-analyzer/web";

// Small inline label used for model names, trigger events, and status
// flags across the turns table, session list, and turn inspector.

export function Variants() {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Tag variant="accent">gpt-4.1</Tag>
      <Tag variant="accent-2">claude-sonnet-5</Tag>
      <Tag variant="neutral">manual</Tag>
      <Tag variant="outline">Tool result</Tag>
    </div>
  );
}

export function InTable() {
  return (
    <table className="table" style={{ maxWidth: 360 }}>
      <thead>
        <tr>
          <th>Turn</th>
          <th>Trigger</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>
            <Tag variant="outline">User message</Tag>
          </td>
        </tr>
        <tr>
          <td>2</td>
          <td>
            <Tag variant="outline">Tool result</Tag>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
