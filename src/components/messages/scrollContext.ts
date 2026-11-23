import { createContext, useContext } from 'react'

/** 用户上滑或展开思考内容时暂停跟随底部。 */
export const ScrollToBottomContext = createContext(() => {})

export const useStopFollowing = () => useContext(ScrollToBottomContext)
