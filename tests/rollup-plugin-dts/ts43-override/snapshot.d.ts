// index.d.ts
interface ShowT {}
interface HideT {}
declare class SomeComponent {
  show(): ShowT;
  hide(): HideT;
}
export declare class SpecializedComponent extends SomeComponent {
  override show(): ShowT;
  override hide(): HideT;
}
export {};