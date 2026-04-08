export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface GifOverlay {
  id: string;
  file: File;
  url: string;
  position: Position;
  size: Size;
  rotationDeg: number;
  isVisible: boolean;
}

export interface RenderOverlay {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
}

