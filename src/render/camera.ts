/**
 * Camera: pan, zoom, and the two coordinate conversions everything else needs.
 */

export class Camera {
  x = 0
  y = 0
  zoom = 1

  minZoom = 0.4
  maxZoom = 4

  constructor(
    public viewWidth: number,
    public viewHeight: number,
  ) {}

  /** Centre the camera on a point in world (pixel) space. */
  centerOn(worldX: number, worldY: number): void {
    this.x = worldX - this.viewWidth / 2 / this.zoom
    this.y = worldY - this.viewHeight / 2 / this.zoom
  }

  /** Fit a world-space rectangle into the viewport with a margin. */
  fit(worldWidth: number, worldHeight: number, margin = 40): void {
    const zx = (this.viewWidth - margin * 2) / worldWidth
    const zy = (this.viewHeight - margin * 2) / worldHeight
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.min(zx, zy)))
    this.centerOn(worldWidth / 2, worldHeight / 2)
  }

  panByScreen(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom
    this.y -= dyScreen / this.zoom
  }

  /** Zoom about a screen point, so the world point under the cursor stays put. */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY)
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor))
    const after = this.screenToWorld(screenX, screenY)
    this.x += before.x - after.x
    this.y += before.y - after.y
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom }
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom }
  }

  resize(w: number, h: number): void {
    this.viewWidth = w
    this.viewHeight = h
  }
}
