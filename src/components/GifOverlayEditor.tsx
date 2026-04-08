"use client";

import { useMemo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import type { GifOverlay, Position, Size } from "@/types/video-editor";

type Props = {
  gif: GifOverlay;
  boundsSelector: string;
  isInteractive: boolean;
  onUpdatePosition: (id: string, position: Position) => void;
  onUpdateSize: (id: string, size: Size) => void;
  onUpdateRotation: (id: string, rotationDeg: number) => void;
  onRemove: (id: string) => void;
  onToggleVisible: (id: string) => void;
};

export function GifOverlayEditor({
  gif,
  boundsSelector,
  isInteractive,
  onUpdatePosition,
  onUpdateSize,
  onUpdateRotation,
  onRemove,
  onToggleVisible,
}: Props) {
  const [isSelected, setIsSelected] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);
  const rotateSessionRef = useRef<{
    startAngleRad: number;
    startRotationDeg: number;
    centerX: number;
    centerY: number;
  } | null>(null);
  const rotatePointerIdRef = useRef<number | null>(null);
  const rotateCleanupRef = useRef<(() => void) | null>(null);

  const position = useMemo(() => ({ x: gif.position.x, y: gif.position.y }), [gif.position.x, gif.position.y]);

  return (
    <div
      className="absolute inset-0"
      style={{
        display: gif.isVisible ? "block" : "none",
      }}
    >
      <Rnd
        bounds={boundsSelector}
        position={position}
        size={{ width: gif.size.width, height: gif.size.height }}
        minWidth={32}
        minHeight={32}
        cancel=".rotate-handle"
        disableDragging={!isInteractive || isRotating}
        onDrag={(_e, data) => onUpdatePosition(gif.id, { x: data.x, y: data.y })}
        onDragStop={(_e, data) => onUpdatePosition(gif.id, { x: data.x, y: data.y })}
        onResize={(_e, _dir, _ref, _delta, newPos) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const el = _ref as any as HTMLElement;
          onUpdateSize(gif.id, { width: el.offsetWidth, height: el.offsetHeight });
          onUpdatePosition(gif.id, { x: newPos.x, y: newPos.y });
        }}
        onResizeStop={(_e, _dir, _ref, _delta, newPos) => {
          // _ref is the resized element
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const el = _ref as any as HTMLElement;
          onUpdateSize(gif.id, { width: el.offsetWidth, height: el.offsetHeight });
          onUpdatePosition(gif.id, { x: newPos.x, y: newPos.y });
        }}
        enableResizing={
          isInteractive && isSelected && !isRotating
            ? {
                top: true,
                right: true,
                bottom: true,
                left: true,
                topRight: true,
                bottomRight: false, // reserved for rotate handle
                bottomLeft: true,
                topLeft: true,
              }
            : false
        }
        className={isSelected ? "ring-2 ring-blue-500" : ""}
      >
        <div ref={boxRef} className="relative h-full w-full" onMouseDown={() => isInteractive && setIsSelected(true)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gif.url}
            alt="GIF overlay"
            className="h-full w-full object-contain select-none pointer-events-none"
            style={{ transform: `rotate(${gif.rotationDeg}deg)`, transformOrigin: "center center" }}
          />

          {isInteractive && isSelected && (
            <div className="absolute -top-10 right-0 flex gap-2">
              <button
                type="button"
                className="rounded bg-zinc-900/80 px-2 py-1 text-xs text-white hover:bg-zinc-900"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onToggleVisible(gif.id)}
                title="Show/hide"
              >
                {gif.isVisible ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                className="rounded bg-red-600/90 px-2 py-1 text-xs text-white hover:bg-red-600"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onRemove(gif.id)}
                title="Remove"
              >
                Remove
              </button>
            </div>
          )}

          {isInteractive && isSelected && (
            <button
              type="button"
              className="rotate-handle absolute -bottom-3 -right-3 h-6 w-6 rounded-full bg-blue-500 shadow-[0_0_0_2px_rgba(0,0,0,0.45)]"
              style={{ cursor: isRotating ? "grabbing" : "grab", touchAction: "none" }}
              title="Rotate"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!boxRef.current) return;

                const rect = boxRef.current.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const startAngleRad = Math.atan2(e.clientY - centerY, e.clientX - centerX);

                rotateSessionRef.current = {
                  startAngleRad,
                  startRotationDeg: gif.rotationDeg,
                  centerX,
                  centerY,
                };
                rotatePointerIdRef.current = e.pointerId;
                setIsRotating(true);

                // Ensure we don't leak listeners across sessions.
                rotateCleanupRef.current?.();

                const onMove = (ev: PointerEvent) => {
                  if (rotatePointerIdRef.current !== ev.pointerId) return;
                  const session = rotateSessionRef.current;
                  if (!session) return;
                  const ang = Math.atan2(ev.clientY - session.centerY, ev.clientX - session.centerX);
                  const deltaDeg = ((ang - session.startAngleRad) * 180) / Math.PI;
                  onUpdateRotation(gif.id, session.startRotationDeg + deltaDeg);
                };

                const finish = (ev: PointerEvent) => {
                  if (rotatePointerIdRef.current !== ev.pointerId) return;
                  rotatePointerIdRef.current = null;
                  rotateSessionRef.current = null;
                  setIsRotating(false);
                  rotateCleanupRef.current?.();
                  rotateCleanupRef.current = null;
                };

                window.addEventListener("pointermove", onMove, { passive: true });
                window.addEventListener("pointerup", finish, { passive: true, once: true });
                window.addEventListener("pointercancel", finish, { passive: true, once: true });
                rotateCleanupRef.current = () => {
                  window.removeEventListener("pointermove", onMove);
                  window.removeEventListener("pointerup", finish);
                  window.removeEventListener("pointercancel", finish);
                };
              }}
            >
              <span className="block text-center text-xs font-bold leading-6 text-zinc-950">↻</span>
            </button>
          )}
        </div>
      </Rnd>
    </div>
  );
}

