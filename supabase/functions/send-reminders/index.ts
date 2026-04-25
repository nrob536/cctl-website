import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
  throw new Error('Missing required environment variables')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface OverdueBooking {
  id: string
  member_id: string
  toy_id: string
  due_date: string
  last_reminded_at: string | null
  toy_name: string
  member_email: string
  member_name: string
  days_overdue: number
}

Deno.serve(async (req) => {
  try {
    console.log('Starting send-reminders function')

    // Query overdue bookings
    const now = new Date().toISOString()
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: overdueBookings, error: queryError } = await supabase
      .from('bookings')
      .select(`
        id,
        member_id,
        toy_id,
        due_date,
        last_reminded_at,
        toys (name),
        members (name, email)
      `)
      .lt('due_date', now)
      .is('returned_at', null)

    if (queryError) {
      console.error('Error querying overdue bookings:', queryError)
      return new Response(
        JSON.stringify({ error: queryError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!overdueBookings || overdueBookings.length === 0) {
      console.log('No overdue bookings found')
      return new Response(
        JSON.stringify({ message: 'No overdue bookings', count: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Found ${overdueBookings.length} overdue bookings`)

    const processedBookings: string[] = []
    const failedBookings: string[] = []

    // Process each overdue booking
    for (const booking of overdueBookings) {
      try {
        // Skip if reminded in last 24 hours
        if (booking.last_reminded_at && new Date(booking.last_reminded_at) > new Date(twentyFourHoursAgo)) {
          console.log(`Skipping booking ${booking.id} - already reminded within 24 hours`)
          continue
        }

        const toyName = booking.toys?.name || 'Unknown Toy'
        const memberName = booking.members?.name || 'Member'
        const memberEmail = booking.members?.email || ''

        if (!memberEmail) {
          console.warn(`No email found for booking ${booking.id}`)
          failedBookings.push(booking.id)
          continue
        }

        const daysOverdue = Math.floor((new Date(now).getTime() - new Date(booking.due_date).getTime()) / (1000 * 60 * 60 * 24))
        const dueDate = new Date(booking.due_date).toLocaleDateString('en-NZ', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })

        // Send email via Resend
        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'noreply@yourdomain.nz',
            to: memberEmail,
            subject: `Reminder: Overdue Toy from Hamilton Community Toy Library`,
            text: `Hi ${memberName},

We wanted to remind you that "${toyName}" is now overdue.

Due Date: ${dueDate}
Days Overdue: ${daysOverdue}

Please return this toy to the library as soon as possible. You can check your bookings and renew toys (if allowed) at:
${Deno.env.get('WEBSITE_URL')}/my-bookings.html

If you have any questions, please contact us.

Thanks,
Hamilton Community Toy Library`
          })
        })

        if (!emailResponse.ok) {
          const errorData = await emailResponse.text()
          console.error(`Failed to send email for booking ${booking.id}:`, errorData)
          failedBookings.push(booking.id)
          continue
        }

        // Update last_reminded_at
        const { error: updateError } = await supabase
          .from('bookings')
          .update({ last_reminded_at: now })
          .eq('id', booking.id)

        if (updateError) {
          console.error(`Failed to update booking ${booking.id}:`, updateError)
          failedBookings.push(booking.id)
          continue
        }

        processedBookings.push(booking.id)
        console.log(`Processed reminder for booking ${booking.id} (${memberEmail})`)

      } catch (err) {
        console.error(`Error processing booking ${booking.id}:`, err)
        failedBookings.push(booking.id)
      }
    }

    const result = {
      message: 'Reminder emails sent',
      processed: processedBookings.length,
      failed: failedBookings.length,
      total: overdueBookings.length,
      processedIds: processedBookings,
      failedIds: failedBookings
    }

    console.log('Result:', result)

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Unexpected error in send-reminders function:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
