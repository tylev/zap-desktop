import { getIntl } from '@zap/i18n'
import { convert } from '@zap/utils/btc'
import { CoinBig } from '@zap/utils/coin'
import { isAutopayEnabled } from '@zap/utils/featureFlag'
import { decodePayReq } from '@zap/utils/crypto'
import { showError } from 'reducers/notification'
import { walletSelectors } from 'reducers/wallet'
import { showAutopayNotification, autopaySelectors } from 'reducers/autopay'
import { payInvoice } from 'reducers/payment'
import { setRedirectPayReq, setLnurlWithdrawalParams } from './reducer'
import messages from './messages'

// ------------------------------------
// IPC
// ------------------------------------

/**
 * lightningPaymentUri - Initiate lightning payment flow.
 *
 * @param  {event} event Event
 * @param  {{ address }} address Address (payment request)
 * @returns {Function} Thunk
 */
export const lightningPaymentUri = (event, { address }) => (dispatch, getState) => {
  const state = getState()

  const forwardToMainWindow = () => {
    dispatch(setRedirectPayReq({ address }))
  }

  // If the user is not logged into a wallet or autopay is not enabled just forward the payment request to the main
  // window and return early.
  if (!isAutopayEnabled || !walletSelectors.isWalletOpen(state)) {
    return forwardToMainWindow()
  }

  // Otherwise check if this payment request qualifies for autopay.
  try {
    const autopayList = autopaySelectors.autopayList(state)
    const invoice = decodePayReq(address)
    const { payeeNodeKey, satoshis, millisatoshis } = invoice
    const amountInSats = satoshis || convert('msats', 'sats', millisatoshis)
    const autopayEntry = autopayList[payeeNodeKey]

    // If autopay is enabled for the node pubkey we got from the invoice and the amount of the invoice is less
    // than the autopay's configured limit, pay the invoice silently in the background.
    if (autopayEntry && CoinBig(amountInSats).lte(autopayEntry.limit)) {
      dispatch(showAutopayNotification(invoice))
      return dispatch(payInvoice({ payReq: address, amt: amountInSats }))
    }

    // If it wasn't handled with autopay or there was an error, open in the pay form and focus the app.
    return forwardToMainWindow()
  } catch (e) {
    return forwardToMainWindow()
  }
}

/**
 * bitcoinPaymentUri - Initiate bitcoin payment flow.
 *
 * @param  {event} event Event
 * @param  {{ address, options }} options Decoded bip21 payment url
 * @returns {Function} Thunk
 */
export const bitcoinPaymentUri = (event, { address, options = {} }) => dispatch => {
  // If the bip21 data includes a bolt11 invoice in the `lightning` key handle as a lightning payment.
  const { lightning } = options
  if (lightning) {
    dispatch(lightningPaymentUri(event, { address: lightning }))
  }
  // Otherwise, use the bitcoin address for on-chain payment.
  else {
    const { amount } = options
    dispatch(setRedirectPayReq({ address, amount }))
  }
}

export const saturnUri = (event, { address, options = {} }) => dispatch => {
  console.warn('saturnUri IPC.js CALLED')
  const { amount } = options
  dispatch(setRedirectPayReq({ address, amount }))
}

/**
 * lnurlError - IPC handler for lnurlError event.
 *
 * @param  {event} event Event ipc event
 * @param  {object} params { service, reason }
 * @param  {string} params.service lnurl
 * @param  {string} params.reason error reason
 * @returns {Function} Thunk
 */
export const lnurlError = (event, { service, reason }) => dispatch => {
  const intl = getIntl()
  dispatch(showError(intl.formatMessage(messages.pay_lnurl_withdraw_error, { reason, service })))
}

/**
 * lnurlRequest - IPC handler for lnurlRequest event.
 *
 * @param  {event} event Event ipc event
 * @param  {object} params { service, amount, memo }
 * @param  {string} params.service lnurl
 * @param  {number} params.amount ln pr amount
 * @param  {string} params.memo ln pr memo
 * @returns {Function} Thunk
 */
export const lnurlRequest = (event, { service, amount, memo }) => dispatch => {
  dispatch(setLnurlWithdrawalParams({ amount, service, memo }))
}
