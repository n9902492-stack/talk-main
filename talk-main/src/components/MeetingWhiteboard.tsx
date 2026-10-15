import { useId, useRef, useState, type PointerEvent } from 'react';
import { Pencil, Undo2, Trash2 } from 'lucide-react';

type Stroke = { id: number; path: string; color: string };
type Drawing = { pointerId: number; strokeId: number };

const colors = ['#795900', '#5b4bb7', '#d13b5e', '#288a66'];

export default function MeetingWhiteboard() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState(colors[0]);
  const svgRef = useRef<SVGSVGElement>(null);
  const drawingRef = useRef<Drawing | null>(null);
  const strokeIdRef = useRef(0);
  const instructionsId = useId();

  const point = (event: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const transform = svg?.getScreenCTM();
    if (!svg || !transform) return null;
    const position = svg.createSVGPoint();
    position.x = event.clientX;
    position.y = event.clientY;
    const local = position.matrixTransform(transform.inverse());
    return `${local.x.toFixed(2)},${local.y.toFixed(2)}`;
  };

  const finishStroke = (event: PointerEvent<SVGSVGElement>) => {
    if (drawingRef.current?.pointerId !== event.pointerId) return;
    drawingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const cancelDrawing = () => {
    const drawing = drawingRef.current;
    drawingRef.current = null;
    if (drawing && svgRef.current?.hasPointerCapture(drawing.pointerId)) {
      svgRef.current.releasePointerCapture(drawing.pointerId);
    }
  };

  return (
    <div className="whiteboard">
      <div className="whiteboard-toolbar" role="toolbar" aria-label="Drawing controls">
        <Pencil size={16} aria-hidden="true" />
        <span className="text-xs">Draw together</span>
        {colors.map(value => (
          <button
            key={value}
            type="button"
            className={`color-dot ${color === value ? 'active' : ''}`}
            style={{ background: value }}
            aria-label={`Draw in ${value}`}
            aria-pressed={color === value}
            onClick={() => setColor(value)}
          />
        ))}
        <button
          type="button"
          aria-label="Undo last stroke"
          disabled={!strokes.length}
          onClick={() => {
            cancelDrawing();
            setStrokes(previous => previous.slice(0, -1));
          }}
        >
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Clear drawing"
          disabled={!strokes.length}
          onClick={() => {
            cancelDrawing();
            setStrokes([]);
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="board-content">
        <h2>Which of these tools can be used for<br />Social Media Marketing?</h2>
        <div className="social-tools">
          <span className="bg-[#7953e0]">Discord</span>
          <span className="bg-[#bd427b]">Instagram</span>
          <span className="bg-[#2194ca]">Twitter</span>
          <span className="bg-[#2c9b65]">Spotify</span>
          <span className="bg-[#f07842]">Figma</span>
          <span className="bg-[#171717]">TikTok</span>
        </div>
        <p className="board-note" id={instructionsId}>Share your ideas. Make your mark.</p>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 1000 600"
        preserveAspectRatio="none"
        className="drawing-layer"
        aria-label="Interactive drawing canvas"
        aria-describedby={instructionsId}
        onPointerDown={event => {
          if (event.button !== 0 || drawingRef.current) return;
          const start = point(event);
          if (!start) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const id = ++strokeIdRef.current;
          drawingRef.current = { pointerId: event.pointerId, strokeId: id };
          setStrokes(previous => [...previous, { id, path: `M${start} L${start}`, color }]);
        }}
        onPointerMove={event => {
          const drawing = drawingRef.current;
          if (!drawing || drawing.pointerId !== event.pointerId) return;
          const next = point(event);
          if (!next) return;
          event.preventDefault();
          setStrokes(previous => previous.map(stroke => stroke.id === drawing.strokeId
            ? { ...stroke, path: `${stroke.path} L${next}` }
            : stroke));
        }}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        onLostPointerCapture={event => {
          if (drawingRef.current?.pointerId === event.pointerId) drawingRef.current = null;
        }}
      >
        {strokes.map(stroke => (
          <path
            key={stroke.id}
            d={stroke.path}
            stroke={stroke.color}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}
