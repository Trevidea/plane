// Track the user's volume separately from the temporary narration multiplier.
export class NarrationDucking {
  private baseVolume: number;
  private lastWritten: number;
  private factor = 1;
  private video: Pick<HTMLMediaElement, "volume">;
  constructor(video: Pick<HTMLMediaElement, "volume">) {
    this.video = video;
    this.baseVolume = video.volume;
    this.lastWritten = video.volume;
  }
  tick(target: number, elapsedSeconds: number) {
    if (Math.abs(this.video.volume - this.lastWritten) > 0.001) this.baseVolume = this.video.volume;
    const step = Math.min(1, Math.max(0, elapsedSeconds) / 0.15);
    this.factor += (target - this.factor) * step;
    if (Math.abs(target - this.factor) < 0.001) this.factor = target;
    this.lastWritten = Math.max(0, Math.min(1, this.baseVolume * this.factor));
    if (Math.abs(this.video.volume - this.lastWritten) > 0.00001) this.video.volume = this.lastWritten;
  }
  restore() {
    if (Math.abs(this.video.volume - this.lastWritten) > 0.001) this.baseVolume = this.video.volume;
    this.video.volume = this.baseVolume;
    this.lastWritten = this.baseVolume;
    this.factor = 1;
  }
}
