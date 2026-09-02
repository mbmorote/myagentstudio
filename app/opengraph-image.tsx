import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'MyAgentStudio — AI-Agent Workbench';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '80px',
          background: 'linear-gradient(135deg, #0b1622 0%, #0b4f85 55%, #1479c9 100%)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 28,
            color: '#8ecbf2',
            letterSpacing: 2,
            marginBottom: 28,
          }}
        >
          MYAGENTSTUDIO.DEV
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 96,
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1.05,
          }}
        >
          MyAgentStudio
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 42,
            color: '#dbe9f5',
            marginTop: 20,
            maxWidth: 900,
          }}
        >
          AI-Agent Workbench
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 26,
            color: '#a9c9e2',
            marginTop: 44,
          }}
        >
          Review-before-apply AI editing · Lossless import · MCP console access
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 48,
          }}
        >
          {['Next.js', 'Claude', 'MCP', 'AWS', 'CI/CD'].map((tag, i) => (
            <div
              key={tag}
              style={{
                display: 'flex',
                fontSize: 24,
                color: '#0b1622',
                background: '#ffffff',
                padding: '10px 22px',
                borderRadius: 999,
                marginRight: i === 4 ? 0 : 16,
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
