import type { Customer, Discount } from '$shared/types'
import type Stripe from 'stripe'

import { error } from '@sveltejs/kit'

import { CUSTOMER, SEAT_DETAILS, TRANSACTION_ID_EXISTS } from '$shared/queries'
import { calculateTotal, log } from '$shared/utils'

import { REQUEST_KEY, type DataStore } from '../data-store.js'
import { sanity } from '../sanity.js'
import { stripe } from '../stripe.js'

export interface BookingData {
  customer: { name: string; email: string; phone: string }
  show: string
  seats: string[]
  discount?: Discount
  campaigns?: string[]
  stripeId?: string
}

export async function parseStripeChargeEvent(event: Stripe.Event): Promise<BookingData> {
  if (event.type !== 'charge.succeeded') {
    throw error(400, 'This webhook is only valid for `charge.succeeded` events')
  }

  const {
    id,
    billing_details: { name, email, phone },
    metadata,
  } = event.data.object as Stripe.Charge

  if (!name || !email || !phone) {
    throw error(400, 'Customer data missing')
  }

  if (await idExists(id)) {
    log.warn(`Transaction ID "${id}" already exists in Sanity database.`)
    await log.flush()
    throw error(409, 'Duplicate transaction')
  }

  const show = metadata.show as string
  const seats = JSON.parse(metadata.seatIds) as string[]
  const discount = (metadata.discount && JSON.parse(metadata.discount)) as Discount | undefined
  const campaigns = (metadata.campaigns && JSON.parse(metadata.campaigns)) as string[] | undefined

  if (!show || !seats) {
    throw error(400, 'Booking data missing')
  }

  return {
    show,
    seats,
    discount,
    campaigns,
    customer: { name, email, phone },
    stripeId: id,
  }
}

export async function parseFreeCheckout(
  body: string,
  store: DataStore,
  svelteFetch: typeof fetch,
): Promise<BookingData> {
  const { name, email, phone, show, seatIds, discount, campaigns } = JSON.parse(body) as {
    name: string
    email: string
    phone: string
    show: string
    seatIds: string[]
    discount: Discount | undefined
    campaigns: string[] | undefined
  }

  store.set(REQUEST_KEY.SEAT_DETAILS, sanity.fetch(SEAT_DETAILS, { seats: seatIds }))

  // Validate that booking doesn't require payment
  if (!(await validateFreeCheckout(show, discount?.code, store, svelteFetch))) {
    log.error('Payment required for free checkout attempt')
    throw error(402, 'Payment is required for this checkout')
  }

  return {
    show,
    seats: seatIds,
    discount,
    campaigns,
    customer: { name, email, phone },
  }
}

export async function getCustomer({
  name,
  email,
  phone,
}: {
  name: string
  email: string
  phone: string
}): Promise<Customer> {
  log.debug('Getting customer ID for', name, email)
  const customer = (await sanity.fetch(CUSTOMER, { email })) as Customer

  if (customer) {
    log.info(`Customer ID for ${email} found: ${customer._id}`)
    return customer
  }

  log.debug(`Creating customer ${name} (${email})`)

  let stripeCustomer = (
    await stripe.customers.search({ query: `name: '${name}' AND email: '${email}'` })
  ).data[0]

  if (!stripeCustomer) {
    log.debug('No existing Stripe customer, creating new entity')
    stripeCustomer = await stripe.customers.create({
      name,
      email,
      phone,
    })
  }

  const response = await sanity.create({
    _type: 'customer',
    name,
    email,
    phone,
    stripeId: stripeCustomer.id,
  })

  log.info('Created new customer', response._id)
  return response
}

async function idExists(id: string): Promise<boolean> {
  return sanity.fetch(TRANSACTION_ID_EXISTS, { id })
}

async function validateFreeCheckout(
  show: string,
  discountCode: string | undefined,
  store: DataStore,
  svelteFetch: typeof fetch,
) {
  try {
    const [config, seats, discount] = await Promise.all([
      store.get(REQUEST_KEY.CONFIG),
      store.get(REQUEST_KEY.SEAT_DETAILS),
      await svelteFetch(`/api/config/discount/${show}/${discountCode}`).then((response) =>
        response.json(),
      ),
    ])

    if (!seats || !config) {
      return false
    }

    return (
      calculateTotal(seats, show, config?.priceTiers, config?.priceConfiguration, discount) === 0
    )
  } catch (e) {
    console.error(e)
    return false
  }
}
