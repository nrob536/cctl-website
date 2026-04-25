// My bookings page logic
let currentUserId = null

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('library-name').textContent = LIBRARY_NAME

  // Handle lookup form
  const lookupForm = document.getElementById('lookup-form')
  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    await handleLookup()
  })

  // Handle logout
  const logoutBtn = document.getElementById('logout-btn')
  logoutBtn.addEventListener('click', () => {
    document.getElementById('lookup-section').style.display = 'block'
    document.getElementById('bookings-section').style.display = 'none'
    document.getElementById('lookup-user-id').value = ''
    document.getElementById('lookup-message').innerHTML = ''
    currentUserId = null
  })
})

async function handleLookup() {
  const userId = document.getElementById('lookup-user-id').value.trim()
  const lookupBtn = document.getElementById('lookup-btn')
  const lookupMessage = document.getElementById('lookup-message')

  if (!userId) {
    lookupMessage.innerHTML = '<div class="message message-error">Please enter your user ID.</div>'
    return
  }

  lookupBtn.disabled = true
  lookupBtn.textContent = 'Loading...'
  lookupMessage.innerHTML = ''

  try {
    // Look up member through RPC (members table is not directly readable by client)
    const { data: memberRows, error: memberError } = await window.db
      .rpc('lookup_member', { p_user_id: userId })

    const member = memberRows && memberRows.length > 0 ? memberRows[0] : null

    if (memberError || !member) {
      lookupMessage.innerHTML = '<div class="message message-error">User ID not found. Please check and try again.</div>'
      lookupBtn.disabled = false
      lookupBtn.textContent = 'View My Bookings'
      return
    }

    if (member.is_blocked) {
      lookupMessage.innerHTML = '<div class="message message-error">Your account is blocked. Please contact the library staff.</div>'
      lookupBtn.disabled = false
      lookupBtn.textContent = 'View My Bookings'
      return
    }

    // Store user ID and show bookings
    currentUserId = userId
    document.getElementById('lookup-section').style.display = 'none'
    document.getElementById('bookings-section').style.display = 'block'

    await fetchBookings(userId)

    lookupBtn.disabled = false
    lookupBtn.textContent = 'View My Bookings'
  } catch (err) {
    console.error('Error looking up member:', err)
    lookupMessage.innerHTML = '<div class="message message-error">Error loading member details. Please try again.</div>'
    lookupBtn.disabled = false
    lookupBtn.textContent = 'View My Bookings'
  }
}

async function fetchBookings(userId) {
  try {
    const loading = document.getElementById('loading')
    const noBookings = document.getElementById('no-bookings')
    const bookingsList = document.getElementById('bookings-list')

    loading.style.display = 'block'
    noBookings.style.display = 'none'
    bookingsList.innerHTML = ''

    // Fetch active bookings with toy details through RPC
    const { data: bookings, error } = await window.db
      .rpc('list_active_bookings', { p_user_id: userId })

    if (error) throw error

    loading.style.display = 'none'

    if (!bookings || bookings.length === 0) {
      noBookings.style.display = 'block'
      return
    }

    // Display bookings
    bookingsList.innerHTML = bookings.map(booking => {
      const dueDate = new Date(booking.due_date)
      const today = new Date()
      const isOverdue = dueDate < today
      const toy = {
        id: booking.toy_id,
        name: booking.toy_name,
        category: booking.toy_category
      }

      return `
        <div class="booking-item">
          <h3>${toy.name}</h3>
          <div class="booking-item-meta">
            <div>
              <strong>Category</strong>
              ${toy.category}
            </div>
            <div>
              <strong>Due Date</strong>
              <span style="${isOverdue ? 'color: #dc3545; font-weight: bold;' : ''}">${formatDate(booking.due_date)}${isOverdue ? ' (OVERDUE)' : ''}</span>
            </div>
          </div>
          <div class="booking-item-meta">
            <div>
              <strong>Renewals Used</strong>
              ${booking.renewal_count} / 2
            </div>
          </div>
          <div class="booking-item-actions">
            <button class="btn-primary ${booking.renewal_count >= 2 ? 'btn-disabled' : ''}" 
              ${booking.renewal_count >= 2 ? 'disabled' : ''} 
              onclick="renewBooking('${booking.booking_id}', ${booking.renewal_count})"
              title="${booking.renewal_count >= 2 ? 'Maximum renewals reached' : ''}">
              Renew
            </button>
            <button class="btn-danger" onclick="returnToy('${booking.booking_id}')">
              Return
            </button>
          </div>
        </div>
      `
    }).join('')

  } catch (err) {
    console.error('Error fetching bookings:', err)
    const loading = document.getElementById('loading')
    loading.innerHTML = '<div class="message message-error">Error loading bookings. Please try again.</div>'
  }
}

async function renewBooking(bookingId, currentRenewalCount) {
  if (currentRenewalCount >= 2) {
    alert('You have reached the maximum number of renewals (2).')
    return
  }

  const confirmed = confirm('Renew this booking for 14 more days?')
  if (!confirmed) return

  try {
    const { data: rows, error: renewError } = await window.db
      .rpc('renew_booking', {
        p_user_id: currentUserId,
        p_booking_id: bookingId
      })

    if (renewError) {
      const code = String(renewError.message || '')
      if (code.includes('MAX_RENEWALS_REACHED')) {
        alert('You have reached the maximum number of renewals (2).')
        return
      }
      throw renewError
    }

    const newDueDate = rows && rows[0] ? rows[0].due_date : null
    alert(`Booking renewed! New due date: ${formatDate(newDueDate)}`)
    await fetchBookings(currentUserId)

  } catch (err) {
    console.error('Error renewing booking:', err)
    alert('Error renewing booking. Please try again.')
  }
}

async function returnToy(bookingId) {
  const confirmed = confirm('Are you sure you want to return this toy?')
  if (!confirmed) return

  try {
    const { error: returnError } = await window.db
      .rpc('return_booking', {
        p_user_id: currentUserId,
        p_booking_id: bookingId
      })

    if (returnError) throw returnError

    alert('Toy returned successfully!')
    await fetchBookings(currentUserId)

  } catch (err) {
    console.error('Error returning toy:', err)
    alert('Error returning toy. Please try again.')
  }
}

function formatDate(dateString) {
  if (!dateString) {
    return 'Unknown date'
  }
  const date = new Date(dateString)
  return date.toLocaleDateString('en-NZ', { year: 'numeric', month: 'long', day: 'numeric' })
}
