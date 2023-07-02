import type { PriceConfiguration, PriceMap, PriceTier } from '../types/configuration.js'
import {
  DISCOUNT_TYPE,
  type Booking,
  type Discount,
  type Seat,
  type BookingWithPrices,
  type SeatWithPrice,
} from '../types/bookings.js'

const BOOKING_FEE = 0.045
const MAX_BOOKING_FEE = 5

export function getSeatPriceTier(
  seat: Seat,
  show: string,
  priceTiers: PriceTier[],
  priceConfiguration: PriceConfiguration,
) {
  const tierRef = getSeatPriceTierId(seat, getPriceMapFromConfig(priceConfiguration, show))
  return priceTiers.find(({ _id }) => _id === tierRef)
}

export function getSeatPrice(
  seat: Seat,
  show: string,
  priceTiers: PriceTier[],
  priceConfiguration: PriceConfiguration,
) {
  const priceTier = getSeatPriceTier(seat, show, priceTiers, priceConfiguration)
  return priceTier?.price
}

export function getLineItem(
  seat: Seat,
  show: string,
  priceTiers: PriceTier[],
  priceConfiguration: PriceConfiguration,
) {
  return {
    description: seat._id,
    price: getSeatPrice(seat, show, priceTiers, priceConfiguration),
  }
}

export function getTotals(prices: number[], discount?: Discount, calculateBookingFee = true) {
  const subtotal = prices.reduce((total, price) => total + price, 0)
  let bookingFee = calculateBookingFee
    ? prices.reduce(
        (bookingFee, price) => bookingFee + Math.min(price * BOOKING_FEE, MAX_BOOKING_FEE),
        0,
      )
    : undefined

  let total = subtotal
  let reduction = 0

  if (discount && discount.value) {
    reduction =
      discount.type === DISCOUNT_TYPE.PERCENTAGE ? total * (discount.value / 100) : discount.value
    total = Math.max(0, total - reduction)

    // Don't charge a booking fee for free checkouts.
    if (total === 0) {
      bookingFee = undefined
    }
  }

  if (bookingFee) {
    total += bookingFee
  }

  const vat = total * 0.05 // 5% VAT.
  const profit = subtotal - reduction - vat

  return {
    subtotal,
    bookingFee,
    reduction,
    total,
    vat,
    profit,
  }
}

export function calculateTotal(
  seats: Seat[],
  show: string,
  priceTiers: PriceTier[],
  priceConfiguration: PriceConfiguration,
  discount?: Discount,
) {
  const prices = seats.map((seat) => getSeatPrice(seat, show, priceTiers, priceConfiguration) ?? 0)
  return getTotals(prices, discount).total
}

function getPriceMapFromConfig(priceConfiguration: PriceConfiguration, showId: string): PriceMap {
  return new Map(
    Object.entries({
      ...priceConfiguration.default,
      ...priceConfiguration[showId],
    }),
  )
}

export function addBookingPrices(
  bookings: Booking[],
  priceConfiguration: PriceConfiguration,
  priceTiers: PriceTier[] | undefined,
): BookingWithPrices[] {
  if (!bookings || !priceConfiguration || !priceTiers) {
    return bookings
  }

  return bookings.map((booking) => {
    const { seats } = booking

    if (!seats) {
      return booking
    }

    const seatsWithPrices: SeatWithPrice[] = seats.map((seat) => ({
      ...seat,
      priceTier: getSeatPriceTier(seat, booking.show._id, priceTiers, priceConfiguration),
    }))

    const { subtotal, reduction, bookingFee, vat, total, profit } = getTotals(
      seatsWithPrices.map(({ priceTier }) => priceTier?.price ?? 0),
      booking.discount,
      booking.source === 'website',
    )

    return {
      ...booking,
      seats: seatsWithPrices,
      subtotal,
      reduction,
      vat,
      bookingFee,
      total,
      profit,
    }
  })
}

function getSeatPriceTierId(seat: Seat, priceMap: PriceMap) {
  const { _id, row, section } = seat

  return priceMap.get(_id) ?? priceMap.get(row) ?? priceMap.get(section) ?? priceMap.get('default')
}
