(function() {
    'use strict';

    // === CONSTANTS ===
    const SCROLL_THRESHOLD = 80;
    const MOBILE_BREAKPOINT = 768;

    // === SELECTORS ===
    const header = document.getElementById('header');
    const navToggle = document.getElementById('nav-toggle');
    const navMenu = document.getElementById('nav-menu');

    // === UTILITIES ===
    function isMobile() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    // === MENU MOBILE ===
    function toggleMenu() {
        navToggle.classList.toggle('active');
        navMenu.classList.toggle('active');
        document.body.classList.toggle('menu-open');
    }

    function closeMenu() {
        navToggle.classList.remove('active');
        navMenu.classList.remove('active');
        document.body.classList.remove('menu-open');
    }

    // === HEADER SCROLL ===
    function handleScroll() {
        if (window.scrollY > SCROLL_THRESHOLD) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    }

    // === SCROLL REVEAL ===
    function initReveal() {
        const reveals = document.querySelectorAll('.section__tag, .section__title, .section__subtitle, .service-card, .concept__problem, .concept__solution, .result-card, .testimonial, .pricing__card, .booking__slot, .contact__item');

        reveals.forEach(function(el) {
            el.classList.add('reveal');
        });

        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        });

        reveals.forEach(function(el) {
            observer.observe(el);
        });
    }

    // === SMOOTH SCROLL FOR ANCHOR LINKS ===
    function initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
            anchor.addEventListener('click', function(e) {
                var targetId = this.getAttribute('href');
                if (targetId === '#') return;

                var target = document.querySelector(targetId);
                if (target) {
                    e.preventDefault();
                    closeMenu();
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });
    }

    // === ACTIVE NAV LINK ===
    function initActiveNav() {
        var sections = document.querySelectorAll('section[id]');
        var navLinks = document.querySelectorAll('.nav__link');

        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    navLinks.forEach(function(link) {
                        link.classList.remove('active');
                        if (link.getAttribute('href') === '#' + entry.target.id) {
                            link.classList.add('active');
                        }
                    });
                }
            });
        }, {
            threshold: 0.3,
            rootMargin: '-100px 0px -50% 0px'
        });

        sections.forEach(function(section) {
            observer.observe(section);
        });
    }

    // === EVENT LISTENERS ===
    if (navToggle) {
        navToggle.addEventListener('click', toggleMenu);
    }

    document.querySelectorAll('.nav__link').forEach(function(link) {
        link.addEventListener('click', closeMenu);
    });

    window.addEventListener('scroll', handleScroll, { passive: true });

    // === TESTIMONIALS CAROUSEL ===
    function initTestimonialsCarousel() {
        var track = document.querySelector('.testimonials__track');
        if (!track) return;

        var slides = track.querySelectorAll('.testimonial');
        var dots = document.querySelectorAll('.testimonials__dot');
        var prevBtn = document.querySelector('.testimonials__arrow--prev');
        var nextBtn = document.querySelector('.testimonials__arrow--next');
        var current = 0;

        function goTo(index) {
            if (index < 0) index = slides.length - 1;
            if (index >= slides.length) index = 0;

            slides.forEach(function(slide) {
                slide.classList.remove('testimonial--active');
            });
            dots.forEach(function(dot) {
                dot.classList.remove('testimonials__dot--active');
            });

            slides[index].classList.add('testimonial--active');
            if (dots[index]) dots[index].classList.add('testimonials__dot--active');
            current = index;
        }

        if (prevBtn) prevBtn.addEventListener('click', function() { goTo(current - 1); });
        if (nextBtn) nextBtn.addEventListener('click', function() { goTo(current + 1); });

        dots.forEach(function(dot, i) {
            dot.addEventListener('click', function() { goTo(i); });
        });

        // Auto-play every 6 seconds
        setInterval(function() { goTo(current + 1); }, 6000);
    }

    // === OBJECTIVE BUTTONS ===
    function initObjectiveButtons() {
        var buttons = document.querySelectorAll('.objective-btn');
        var objectiveWrap = document.getElementById('booking-objective');
        var objectiveValue = document.getElementById('booking-objective-value');
        var bookingCta = document.getElementById('booking-cta');

        if (!buttons.length || !objectiveWrap || !bookingCta) return;

        var baseMsg = 'Bonjour ! Je souhaite r\u00e9server un cr\u00e9neau au Breakfast Club';

        buttons.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var obj = btn.getAttribute('data-objective');
                if (!obj) return;

                // Decode HTML entities (e.g. &eacute;)
                var tmp = document.createElement('textarea');
                tmp.innerHTML = obj;
                var decoded = tmp.value;

                objectiveValue.textContent = decoded;
                objectiveWrap.removeAttribute('hidden');

                var msg = baseMsg + '. Mon objectif : ' + decoded + ' \ud83c\udf53';
                bookingCta.href = 'https://wa.me/32470120300?text=' + encodeURIComponent(msg);

                // Mark button as active, clear others
                buttons.forEach(function(b) { b.classList.remove('objective-btn--active'); });
                btn.classList.add('objective-btn--active');

                // Meta Pixel tracking
                if (typeof fbq === 'function') {
                    fbq('track', 'Lead', {
                        content_name: 'Objective selected',
                        content_category: decoded
                    });
                }
            });
        });
    }

    // === META PIXEL — TRACK SUMUP PAYMENT CLICKS ===
    function initPixelCheckoutTracking() {
        if (typeof fbq !== 'function') return;

        var mapping = {
            'QI6QM8AY': { name: 'S\u00e9ance d\u00e9couverte', amount: 20 },
            'Q26EG5HV': { name: 'Carte 10 visites', amount: 95 },
            'Q4UOP0RB': { name: 'Carte 30 visites', amount: 249 }
        };

        var links = document.querySelectorAll('a[href*="pay.sumup.com"]');
        links.forEach(function(link) {
            link.addEventListener('click', function() {
                var href = link.getAttribute('href') || '';
                var match = href.match(/pay\.sumup\.com\/b2c\/([A-Z0-9]+)/);
                if (!match) return;
                var code = match[1];
                var info = mapping[code];
                if (!info) return;

                fbq('track', 'InitiateCheckout', {
                    content_name: info.name,
                    value: info.amount,
                    currency: 'EUR'
                });
            });
        });
    }

    // === META PIXEL — TRACK WHATSAPP / CONTACT ===
    function initPixelContactTracking() {
        if (typeof fbq !== 'function') return;

        var links = document.querySelectorAll('a[href*="wa.me/"]');
        links.forEach(function(link) {
            link.addEventListener('click', function() {
                fbq('track', 'Contact', {
                    method: 'whatsapp'
                });
            });
        });
    }

    // === DISCOVERY BOOKING FLOW (Cal.com modal -> SumUp 20€) ===
    function initDiscoveryBookingFlow() {
        var btn = document.getElementById('discovery-book-cta');
        if (!btn) return;

        var SUMUP_DISCOVERY_URL = 'https://pay.sumup.com/b2c/QI6QM8AY';

        btn.addEventListener('click', function(e) {
            // If Cal.com SDK loaded, open modal
            if (window.Cal && Cal.ns && Cal.ns['rdv-evaluation-bien-etre-body-scan']) {
                e.preventDefault();
                Cal.ns['rdv-evaluation-bien-etre-body-scan']('modal', {
                    calLink: 'gregory-angiuli-cedagi/rdv-evaluation-bien-etre-body-scan',
                    config: {
                        layout: 'month_view',
                        successRedirectUrl: SUMUP_DISCOVERY_URL,
                        redirectUrl: SUMUP_DISCOVERY_URL
                    }
                });

                // Listen to Cal.com booking_successful event as fallback
                Cal('on', {
                    action: 'bookingSuccessful',
                    callback: function() {
                        // Small delay to let Cal show its confirmation, then redirect
                        setTimeout(function() {
                            window.location.href = SUMUP_DISCOVERY_URL;
                        }, 1500);
                    }
                });

                // Track Lead event on Meta Pixel
                if (typeof fbq === 'function') {
                    fbq('track', 'Lead', {
                        content_name: 'Discovery booking initiated',
                        value: 20,
                        currency: 'EUR'
                    });
                }
            }
        });
    }

    // === RESULTS CAROUSEL (before/after) ===
    function initResultsCarousel() {
        var carousel = document.getElementById('results-carousel');
        if (!carousel) return;

        var track = carousel.querySelector('.results__track');
        var prev = carousel.querySelector('.results__arrow--prev');
        var next = carousel.querySelector('.results__arrow--next');
        if (!track || !prev || !next) return;

        function getScrollAmount() {
            var card = track.querySelector('.result-card');
            if (!card) return 320;
            var gap = 20;
            return card.offsetWidth + gap;
        }

        prev.addEventListener('click', function() {
            track.scrollBy({ left: -getScrollAmount(), behavior: 'smooth' });
        });

        next.addEventListener('click', function() {
            track.scrollBy({ left: getScrollAmount(), behavior: 'smooth' });
        });

        // Hide arrows when at start/end
        function updateArrows() {
            var max = track.scrollWidth - track.clientWidth;
            prev.style.opacity = track.scrollLeft <= 2 ? '0.4' : '1';
            prev.style.pointerEvents = track.scrollLeft <= 2 ? 'none' : 'auto';
            next.style.opacity = track.scrollLeft >= max - 2 ? '0.4' : '1';
            next.style.pointerEvents = track.scrollLeft >= max - 2 ? 'none' : 'auto';
        }

        track.addEventListener('scroll', updateArrows);
        window.addEventListener('resize', updateArrows);
        setTimeout(updateArrows, 100);
    }

    // === WELCOME POPUP ===
    function initWelcomePopup() {
        var popup = document.getElementById('welcome-popup');
        if (!popup) return;

        var STORAGE_KEY = 'bfc_popup_seen';
        var DELAY_MS = 3500;

        // Don't show if user has already seen it this session
        try {
            if (sessionStorage.getItem(STORAGE_KEY) === '1') return;
        } catch (e) {}

        function openPopup() {
            popup.classList.add('popup--open');
            popup.setAttribute('aria-hidden', 'false');
            document.body.classList.add('popup-open');
        }

        function closePopup() {
            popup.classList.remove('popup--open');
            popup.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('popup-open');
            try {
                sessionStorage.setItem(STORAGE_KEY, '1');
            } catch (e) {}
        }

        // Close triggers
        popup.querySelectorAll('[data-popup-close]').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.preventDefault();
                closePopup();
            });
        });

        // CTA click: close popup + scroll to booking (href handles scroll)
        var cta = popup.querySelector('[data-popup-cta]');
        if (cta) {
            cta.addEventListener('click', function() {
                closePopup();
            });
        }

        // Escape key to close
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && popup.classList.contains('popup--open')) {
                closePopup();
            }
        });

        // Auto-open after delay
        setTimeout(openPopup, DELAY_MS);
    }

    // === INIT ===
    handleScroll();
    initReveal();
    initSmoothScroll();
    initActiveNav();
    initTestimonialsCarousel();
    initObjectiveButtons();
    initWelcomePopup();
    initPixelCheckoutTracking();
    initPixelContactTracking();
    initResultsCarousel();
    initDiscoveryBookingFlow();

})();
