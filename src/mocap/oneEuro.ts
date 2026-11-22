/** One-Euro filter (Casiez et al. 2012): low jitter when still, low lag when moving. Time in seconds. */
export class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    public minCutoff = 1.5,
    public beta = 0.8,
    public dCutoff = 1,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
  }

  filter(x: number, t: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(1e-6, t - this.tPrev);
    const dx = (x - this.xPrev) / dt;
    const ad = OneEuro.alpha(this.dCutoff, dt);
    const dxHat = ad * dx + (1 - ad) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuro.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;
    return xHat;
  }
}

/** A bank of independent filters for fixed-size vectors (e.g. 33 landmarks x 3 axes). */
export class OneEuroBank {
  private f: OneEuro[];
  constructor(size: number, minCutoff?: number, beta?: number) {
    this.f = Array.from({ length: size }, () => new OneEuro(minCutoff, beta));
  }
  filter(values: number[], t: number): number[] {
    return values.map((v, i) => this.f[i].filter(v, t));
  }
}
