import { useDialog } from './dialog'
import { INTERVALS } from './review'

// 圖書館：錯題複習、不確定的題目、收藏的題目三個清單（11/20）。
// 角色模式點地圖上的圖書館打開；一般模式在題目上方的錯題複習列直接有按鈕，不用這個對話框。

export type ListKind = 'unsure' | 'favorite'

export const LIST_LABEL: Record<ListKind, string> = {
  unsure: '不確定的題目',
  favorite: '收藏的題目',
}

export function Library(props: {
  review: { due: number; waiting: number; done: number }
  unsure: number
  favorite: number
  onReview: () => void
  onList: (kind: ListKind) => void
  onClose: () => void
}) {
  const { review, unsure, favorite, onReview, onList, onClose } = props
  const dialogRef = useDialog(onClose) // Esc、Tab、焦點（dialog.ts）
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal library" role="dialog" aria-modal="true" aria-label="圖書館" ref={dialogRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h2>圖書館</h2>
        <ul className="library-lists">
          <li>
            <div>
              <strong>錯題複習</strong>
              <span>
                今天到期 {review.due} 題・等待中 {review.waiting}・已攻略 {review.done}
              </span>
              <small>答錯的題目在 {INTERVALS.join('、')} 天後回來，到期後答對才排下一次。</small>
            </div>
            <button className="primary small" onClick={onReview} disabled={!review.due}>
              開始複習
            </button>
          </li>
          <li>
            <div>
              <strong>{LIST_LABEL.unsure}</strong>
              <span>{unsure} 題</span>
              <small>答對但其實是猜的：作答後按「加入不確定清單」。再答一次就移出，答錯會進錯題複習。</small>
            </div>
            <button className="primary small" onClick={() => onList('unsure')} disabled={!unsure}>
              開始
            </button>
          </li>
          <li>
            <div>
              <strong>{LIST_LABEL.favorite}</strong>
              <span>{favorite} 題</span>
              <small>按題目右上角的 ☆ 收藏，取消前都會留著。</small>
            </div>
            <button className="primary small" onClick={() => onList('favorite')} disabled={!favorite}>
              開始
            </button>
          </li>
        </ul>
        <button className="ghost small" onClick={onClose}>
          關閉
        </button>
      </div>
    </div>
  )
}
