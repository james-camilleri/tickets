import CONFIG from '$lib/config.js'
import juice from 'juice'
import nodemailer from 'nodemailer'
import { parseFullName } from 'parse-full-name'
import { BOOKING_DETAILS, EMAIL_TEXT } from 'shared/queries'
import type { BookingDetails, ConfigurationFull, Ticket } from 'shared/types'

import { getCrossOriginHeader } from '../../cors.js'
import { sanity } from '../../sanity.js'
import type { RequestHandler } from './$types.js'
import Email from './template/Email.svelte'

interface BookingPayload {
  bookingId: string
  tickets: Ticket[]
}

export const POST: RequestHandler = async (event) => {
  const { request } = event

  try {
    const { bookingId, tickets } = (await request.json()) as BookingPayload

    const [config, bookingDetails, emailText] = await Promise.all([
      // TODO: FIGURE OUT WHY THE HELL RELATIVE FETCH IS FAILING ON THE SERVER
      (await (await fetch(event.url.origin + '/api/config')).json()) as Promise<ConfigurationFull>,
      // (await (await fetch('/api/config')).json()) as Promise<ConfigurationFull>,
      ((await sanity.fetch(BOOKING_DETAILS, { bookingId })) as BookingDetails[])[0],
      await sanity.fetch(EMAIL_TEXT),
    ])

    const { name, email, date, show, discount } = bookingDetails
    const { showName, showLocation, mapUrl, priceTiers, priceConfiguration } = config

    const { first, middle, nick } = parseFullName(name)
    const firstName =
      middle && nick
        ? `${first} ${middle} ${nick}`
        : middle
        ? `${first} ${middle}`
        : nick
        ? `${first} ${nick}`
        : first ?? ''

    const { host, port } = CONFIG.EMAIL
    const { MAILJET_API_KEY, MAILJET_SECRET_KEY } = process.env

    const transport = nodemailer.createTransport({
      name: 'tickets@arthaus.mt',
      host,
      port,
      auth: {
        user: MAILJET_API_KEY,
        pass: MAILJET_SECRET_KEY,
      },
      pool: true,
      secure: true,
    })

    await transport.sendMail(
      generateEmail(
        name,
        email,
        `Your tickets for ${showName}`,
        generateEmailHtml(
          Email.render({
            name: firstName,
            event: {
              name: showName,
              // TODO: Time Zones. Again.
              date: new Date(date).toLocaleDateString(),
              time: new Date(date).toLocaleTimeString(),
              location: showLocation,
              map: mapUrl,
            },
            show,
            tickets,
            priceTiers,
            priceConfiguration,
            discount,
            emailText,
          }),
        ),
      ),
    )
  } catch (e) {
    return new Response(e as string, {
      status: 500,
      headers: getCrossOriginHeader(request.headers),
    })
  }

  return new Response(null, {
    headers: getCrossOriginHeader(request.headers),
  })
}

function generateEmail(name: string, email: string, subject: string, html: string) {
  return {
    from: 'Arthaus <tickets@arthaus.mt>',
    replyTo: 'tickets@arthaus.mt',
    to: `${name} <${email}>`,
    subject,
    html,
  }
}

function generateEmailHtml({ html, css }: { html: string; css: { code: string } }) {
  return juice(`<style>${css.code}</style>${html}`)
}
