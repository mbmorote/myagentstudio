import { ImageResponse } from 'next/og';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Node.js runtime (not edge) — needed to read the screenshot off disk.
export const alt = 'MyAgentStudio — AI-Agent Workbench';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BAR_HEIGHT = 95;
const SHOT_HEIGHT = size.height - BAR_HEIGHT;

export default async function Image() {
  const screenshotPath = join(process.cwd(), 'docs/images/workbench-overview.jpg');
  const screenshot = readFileSync(screenshotPath).toString('base64');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0b1622',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: BAR_HEIGHT,
            padding: '0 40px',
            background: 'linear-gradient(90deg, #0b1622 0%, #0b4f85 100%)',
          }}
        >
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: '#ffffff' }}>
            MyAgentStudio
          </div>
          <div style={{ display: 'flex', fontSize: 22, color: '#8ecbf2' }}>
            AI-Agent Workbench · myagentstudio.dev
          </div>
        </div>
        <img
          src={`data:image/jpeg;base64,${screenshot}`}
          width={size.width}
          height={SHOT_HEIGHT}
          style={{ objectFit: 'cover' }}
        />
      </div>
    ),
    { ...size }
  );
}
