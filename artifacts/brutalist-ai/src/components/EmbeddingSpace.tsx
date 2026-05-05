import React, { useEffect, useRef, useState } from 'react';
import { SeedData, derivePrng } from '../lib/hash';
import { generateEmbeddingTokens } from '../lib/tokens';

interface EmbeddingSpaceProps {
  seedData: SeedData;
  paused?: boolean;
  /** Increments by 1 per arrow press in export mode; advances one physics step. */
  stepFrame?: number;
}

interface Dot {
  id: number;
  baseX: number;
  baseY: number;
  targetX: number;
  targetY: number;
  x: number;
  y: number;
  label: string;
  lag: number;
  isYou: boolean;
  vx: number;
  vy: number;
}

export function EmbeddingSpace({ seedData, paused = false, stepFrame = 0 }: EmbeddingSpaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dots, setDots] = useState<Dot[]>([]);
  const [hoveredDotId, setHoveredDotId] = useState<number | null>(null);
  const [nearestNeighbors, setNearestNeighbors] = useState<number[]>([]);
  
  const mouseRef = useRef({ x: -1000, y: -1000, active: false });
  const dotsRef = useRef<Dot[]>([]);
  const animPrngRef = useRef<() => number>(() => 0);

  // Initialize dots from seed
  useEffect(() => {
    // Dedicated PRNG for layout/initialization (offset 1)
    const prng = derivePrng(seedData.seedInt, 1);
    // Dedicated PRNG for runtime animation (offset 2) — keeps same seed
    // producing same snap-jump sequence regardless of other panels.
    animPrngRef.current = derivePrng(seedData.seedInt, 2);
    const numDots = 40;
    const tokens = generateEmbeddingTokens(numDots - 1, prng);
    
    const newDots: Dot[] = [];
    
    // Add "you" dot
    newDots.push({
      id: 0,
      baseX: seedData.youX,
      baseY: seedData.youY,
      targetX: seedData.youX,
      targetY: seedData.youY,
      x: seedData.youX,
      y: seedData.youY,
      label: seedData.input,
      lag: 0.1, // Faster response for user dot
      isYou: true,
      vx: (prng() - 0.5) * 0.001,
      vy: (prng() - 0.5) * 0.001
    });
    
    // Add other dots
    for (let i = 0; i < numDots - 1; i++) {
      const x = prng();
      const y = prng();
      newDots.push({
        id: i + 1,
        baseX: x,
        baseY: y,
        targetX: x,
        targetY: y,
        x: x,
        y: y,
        label: tokens[i],
        lag: 0.05 + prng() * 0.2, // Lag between 0.05 and 0.25
        isYou: false,
        vx: (prng() - 0.5) * 0.0005,
        vy: (prng() - 0.5) * 0.0005
      });
    }
    
    setDots(newDots);
    dotsRef.current = newDots;
  }, [seedData]);
  
  // Single physics step. dt is in ms; pass ~16 for one frame's worth.
  const snapTimerRef = useRef(0);
  const stepPhysics = (dt: number) => {
    snapTimerRef.current += dt;
    if (snapTimerRef.current > 3000) {
      snapTimerRef.current = 0;
      const ap = animPrngRef.current;
      if (ap() > 0.5 && dotsRef.current.length > 1) {
        const idx = 1 + Math.floor(ap() * (dotsRef.current.length - 1));
        if (dotsRef.current[idx]) {
          dotsRef.current[idx].baseX = ap();
          dotsRef.current[idx].baseY = ap();
          dotsRef.current[idx].x = dotsRef.current[idx].baseX;
          dotsRef.current[idx].y = dotsRef.current[idx].baseY;
          dotsRef.current[idx].targetX = dotsRef.current[idx].baseX;
          dotsRef.current[idx].targetY = dotsRef.current[idx].baseY;
        }
      }
    }

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mouseActive = mouseRef.current.active;

    const newDots = [...dotsRef.current];

    for (let i = 0; i < newDots.length; i++) {
      const dot = newDots[i];

      if (mouseActive) {
        const mx = (mouseRef.current.x - rect.left) / rect.width;
        const my = (mouseRef.current.y - rect.top) / rect.height;
        const dx = mx - dot.baseX;
        const dy = my - dot.baseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pull = Math.max(0, 1 - dist * 2);
        dot.targetX = dot.baseX + dx * pull * 0.2;
        dot.targetY = dot.baseY + dy * pull * 0.2;
      } else {
        dot.targetX = dot.baseX;
        dot.targetY = dot.baseY;
        dot.baseX += dot.vx;
        dot.baseY += dot.vy;
        if (dot.baseX < 0 || dot.baseX > 1) dot.vx *= -1;
        if (dot.baseY < 0 || dot.baseY > 1) dot.vy *= -1;
        dot.baseX = Math.max(0, Math.min(1, dot.baseX));
        dot.baseY = Math.max(0, Math.min(1, dot.baseY));
      }

      dot.x += (dot.targetX - dot.x) * dot.lag;
      dot.y += (dot.targetY - dot.y) * dot.lag;
    }

    dotsRef.current = newDots;
    setDots(newDots);
  };

  // Live mode: requestAnimationFrame loop.
  useEffect(() => {
    if (paused) return;
    let animationFrameId: number;
    let lastTime = performance.now();

    const animate = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;
      stepPhysics(dt);
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // Paused mode: each arrow press advances one frame (~16ms) of physics.
  useEffect(() => {
    if (!paused || stepFrame === 0) return;
    stepPhysics(16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFrame, paused]);
  
  // Mouse event handlers
  const handleMouseMove = (e: React.MouseEvent) => {
    mouseRef.current = { x: e.clientX, y: e.clientY, active: true };
  };
  
  const handleMouseLeave = () => {
    mouseRef.current.active = false;
    setHoveredDotId(null);
    setNearestNeighbors([]);
  };
  
  // Calculate nearest neighbors on hover
  useEffect(() => {
    if (hoveredDotId === null || paused) return;
    
    const hoverDot = dots.find(d => d.id === hoveredDotId);
    if (!hoverDot) return;
    
    // Calculate distances
    const dists = dots
      .filter(d => d.id !== hoveredDotId)
      .map(d => ({
        id: d.id,
        dist: Math.sqrt(Math.pow(d.x - hoverDot.x, 2) + Math.pow(d.y - hoverDot.y, 2))
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3)
      .map(d => d.id);
      
    setNearestNeighbors(dists);
  }, [hoveredDotId, dots, paused]);
  
  return (
    <div className="brutalist-panel w-full h-full flex flex-col overflow-hidden">
      <div className="brutalist-label z-10 w-full shrink-0 flex justify-between">
        <span>EMBEDDING SPACE</span>
        <span className="text-[#a0a09a] opacity-50">D-256</span>
      </div>
      
      <div 
        ref={containerRef}
        className="relative flex-1 w-full h-full bg-cream cursor-crosshair overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Grid lines */}
        <div className="absolute inset-0 pointer-events-none border-[1px] border-ink/10 m-4"></div>
        <div className="absolute top-1/2 left-4 right-4 h-px bg-ink/10 pointer-events-none"></div>
        <div className="absolute left-1/2 top-4 bottom-4 w-px bg-ink/10 pointer-events-none"></div>

        {/* Faint axis ticks along the inner border (every 10%) */}
        <div className="absolute inset-4 pointer-events-none">
          {Array.from({ length: 11 }).map((_, i) => {
            const pct = i * 10;
            return (
              <React.Fragment key={`tick-${i}`}>
                <div
                  className="absolute top-0 w-px bg-ink/30"
                  style={{ left: `${pct}%`, height: '6px' }}
                />
                <div
                  className="absolute bottom-0 w-px bg-ink/30"
                  style={{ left: `${pct}%`, height: '6px' }}
                />
                <div
                  className="absolute left-0 h-px bg-ink/30"
                  style={{ top: `${pct}%`, width: '6px' }}
                />
                <div
                  className="absolute right-0 h-px bg-ink/30"
                  style={{ top: `${pct}%`, width: '6px' }}
                />
              </React.Fragment>
            );
          })}
        </div>
        
        {/* Draw lines to nearest neighbors */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible">
          {hoveredDotId !== null && nearestNeighbors.map(nId => {
            const hDot = dots.find(d => d.id === hoveredDotId);
            const nDot = dots.find(d => d.id === nId);
            if (!hDot || !nDot) return null;
            
            return (
              <line
                key={`line-${hDot.id}-${nDot.id}`}
                x1={`${hDot.x * 100}%`}
                y1={`${hDot.y * 100}%`}
                x2={`${nDot.x * 100}%`}
                y2={`${nDot.y * 100}%`}
                stroke="#000"
                strokeWidth="3"
              />
            );
          })}
        </svg>
        
        {/* Draw dots */}
        {dots.map(dot => {
          const isHovered = hoveredDotId === dot.id;
          const isNeighbor = nearestNeighbors.includes(dot.id);
          const size = dot.isYou ? 12 : 6;
          
          return (
            <div 
              key={dot.id}
              className="absolute pointer-events-auto"
              style={{
                left: `${dot.x * 100}%`,
                top: `${dot.y * 100}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: dot.isYou ? 30 : isHovered ? 40 : isNeighbor ? 20 : 10
              }}
              onMouseEnter={() => setHoveredDotId(dot.id)}
            >
              <div 
                className="transition-colors duration-0"
                style={{
                  width: size,
                  height: size,
                  backgroundColor: dot.isYou ? seedData.accentColor : '#000',
                  borderRadius: 0, // NO ROUNDED CORNERS
                  boxShadow: dot.isYou ? '4px 4px 0 0 #000' : 'none'
                }}
              />
              
              <div 
                className="absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap px-1 select-none font-mono text-xs font-bold transition-all duration-0"
                style={{
                  backgroundColor: dot.isYou ? seedData.accentColor : (isHovered || isNeighbor ? '#000' : 'transparent'),
                  color: (isHovered || isNeighbor) && !dot.isYou ? seedData.accentColor : '#000',
                  transform: (isHovered || isNeighbor) ? 'scale(1.2)' : 'scale(1)',
                  transformOrigin: 'left center',
                  border: dot.isYou ? '2px solid #000' : 'none'
                }}
              >
                {dot.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
