// Envío de formularios sin recargar la página, con mensajes claros.
//
// Dos modos:
// - Servidor (no hay window.DAIDA_CUENTOS_CONFIG): POST JSON a /api/waitlist y
//   /api/feedback del servidor Node. Sin JavaScript, el formulario se envía igual.
// - Estático (GitHub Pages, hay config.js): POST a config.formEndpoint (Google
//   Apps Script) con Content-Type text/plain para que sea una petición simple
//   sin preflight CORS. Si formEndpoint está vacío, se ofrece un email.
(function () {
  'use strict';
  var EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
  var CONSENT_VERSION = '2026-11-12-abuela-provisional';
  var CONTACT = 'daniel@suarezsa.com';
  var CONFIG = window.DAIDA_CUENTOS_CONFIG;
  var STATIC_MODE = !!CONFIG;

  function setError(form, field, text) {
    var box = form.querySelector('[data-error-for="' + field + '"]');
    var input = form.elements[field];
    if (box) box.textContent = text || '';
    if (input && input.setAttribute) {
      if (text) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function clearErrors(form) {
    var boxes = form.querySelectorAll('[data-error-for]');
    for (var i = 0; i < boxes.length; i++) setError(form, boxes[i].getAttribute('data-error-for'), '');
  }

  function showMsg(form, ok, text, link) {
    var msg = form.querySelector('[data-msg]');
    msg.className = 'msg ' + (ok ? 'msg-ok' : 'msg-error');
    msg.textContent = text;
    if (link) {
      msg.appendChild(document.createTextNode(' '));
      var a = document.createElement('a');
      a.href = link.href;
      a.textContent = link.text;
      msg.appendChild(a);
    }
  }

  function validate(kind, data) {
    var errors = {};
    if (kind === 'waitlist') {
      if (!EMAIL_RE.test(data.email)) errors.email = 'Revisa el correo electrónico: parece que no está bien escrito.';
      if (data.name && data.name.length > 80) errors.name = 'El nombre es muy largo (máximo 80 letras).';
      if (!data.consent) errors.consent = 'Marca la casilla de mayor de 18 años y privacidad para poder apuntarte.';
    } else {
      if (!data.opinion && !data.story_idea) errors.opinion = 'Escribe al menos una de las dos respuestas.';
      if (data.email && !EMAIL_RE.test(data.email)) errors.email = 'Revisa el correo electrónico: parece que no está bien escrito.';
      if (data.email && !data.consent) errors.consent = 'Si nos dejas tu correo, marca la casilla de mayor de 18 años y privacidad.';
    }
    return errors;
  }

  function collect(form) {
    var data = {};
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.name) continue;
      data[el.name] = el.type === 'checkbox' ? el.checked : String(el.value || '').trim();
    }
    return data;
  }

  // Cuerpo que espera el receptor de Google Apps Script (apps-script/Code.gs).
  function staticPayload(kind, data) {
    var now = new Date().toISOString();
    var common = { origin: location.href, user_agent: navigator.userAgent, website: data.website || '' };
    if (kind === 'waitlist') {
      return Object.assign({
        type: 'waitlist',
        name: data.name || '',
        email: data.email,
        consent: data.consent === true,
        consent_marketing: data.consent_marketing === true,
        adult_declared: data.consent === true,
        consent_at: now,
        consent_version: CONSENT_VERSION
      }, common);
    }
    var withEmail = !!data.email;
    return Object.assign({
      type: 'opinion',
      opinion: data.opinion || '',
      story_idea: data.story_idea || '',
      email: data.email || '',
      consent: withEmail && data.consent === true,
      consent_at: withEmail ? now : '',
      consent_version: withEmail ? CONSENT_VERSION : ''
    }, common);
  }

  function mailtoFallback(kind, data) {
    var subject, body;
    if (kind === 'waitlist') {
      subject = 'Quiero apuntarme a la lista de espera de Personal Tales';
      body = 'Hola, quiero apuntarme a la lista de espera.\n\n' +
        'Correo: ' + data.email + '\n' +
        (data.name ? 'Nombre: ' + data.name + '\n' : '') +
        'Soy mayor de 18 años y acepto la política de privacidad para que me aviséis del lanzamiento.\n' +
        'Novedades: ' + (data.consent_marketing ? 'sí, también quiero recibirlas' : 'no') + '\n';
    } else {
      subject = 'Mi opinión sobre Personal Tales';
      body = '¿Qué te parece la idea?\n' + (data.opinion || '') + '\n\n' +
        '¿Qué cuento le harías a tu hijo?\n' + (data.story_idea || '') + '\n';
    }
    return 'mailto:' + CONTACT + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  var STATIC_ERRORS = {
    waitlist: {
      datos: 'Revisa el correo electrónico: parece que no está bien escrito.',
      consentimiento: 'Falta marcar la casilla de mayor de 18 años y privacidad.'
    },
    opinion: {
      datos: 'Escribe al menos una respuesta y revisa el correo si lo has puesto.',
      consentimiento: 'Si nos dejas tu correo, marca la casilla de mayor de 18 años y privacidad.'
    },
    formato: 'No hemos podido leer el formulario. Prueba otra vez.',
    tipo: 'Algo no cuadra en el formulario. Recarga la página y prueba otra vez.'
  };

  function sendStatic(kind, data) {
    var endpoint = String(CONFIG.formEndpoint || '').trim();
    if (!endpoint) {
      return Promise.resolve({ fallback: true });
    }
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(staticPayload(kind, data)),
      redirect: 'follow'
    })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (body && body.ok && body.duplicate) {
          return { ok: true, message: 'Este correo ya estaba en la lista. ¡No hace falta que te apuntes otra vez!' };
        }
        if (body && body.ok) {
          return { ok: true, message: kind === 'waitlist'
            ? '¡Gracias' + (data.name ? ', ' + data.name : '') + '! Ya estás en la lista. Te escribiremos en cuanto abramos.'
            : '¡Gracias por tu opinión! Nos ayuda muchísimo.' };
        }
        var code = body && body.error;
        var field = code === 'consentimiento' ? 'consent' : code === 'datos' ? (kind === 'waitlist' ? 'email' : 'opinion') : null;
        var text = (STATIC_ERRORS[kind] && STATIC_ERRORS[kind][code]) || STATIC_ERRORS[code] ||
          'Algo ha fallado. Prueba otra vez en un rato.';
        return { ok: false, error: text, field: field };
      });
  }

  function sendServer(form, data) {
    return fetch(form.getAttribute('action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (body.ok) return { ok: true, message: body.message || '¡Hecho! Gracias.' };
        // 409: el email ya estaba en la lista; no es un error para la persona.
        if (res.status === 409) return { ok: true, keep: true, message: body.error };
        return { ok: false, error: body.error || 'Algo ha fallado. Prueba otra vez en un rato.', field: body.field };
      });
    });
  }

  function onSubmit(event) {
    var form = event.currentTarget;
    var kind = form.getAttribute('data-form');
    event.preventDefault();
    clearErrors(form);
    var data = collect(form);
    var errors = validate(kind, data);
    var fields = Object.keys(errors);
    if (fields.length) {
      fields.forEach(function (f) { setError(form, f, errors[f]); });
      showMsg(form, false, 'Revisa lo que está en rojo, por favor.');
      var first = form.elements[fields[0]];
      if (first && first.focus) first.focus();
      return;
    }

    var button = form.querySelector('button[type="submit"]');
    var label = button.textContent;
    button.disabled = true;
    button.textContent = 'Enviando...';

    var sending = STATIC_MODE ? sendStatic(kind, data) : sendServer(form, data);
    sending
      .then(function (r) {
        if (r.fallback) {
          showMsg(form, false, kind === 'waitlist'
            ? 'Todavía estamos montando la lista. Escríbenos a ' + CONTACT + ' y te apuntamos a mano.'
            : 'Todavía estamos montando el formulario. Escríbenos a ' + CONTACT + ' y nos llega igual.',
            { href: mailtoFallback(kind, data), text: 'Escribir el correo' });
        } else if (r.ok) {
          showMsg(form, true, r.message);
          if (!r.keep) form.reset();
        } else {
          if (r.field) setError(form, r.field, r.error);
          showMsg(form, false, r.error);
        }
      })
      .catch(function () {
        showMsg(form, false, 'No hay conexión o algo ha fallado. Prueba otra vez en un rato.');
      })
      .then(function () {
        button.disabled = false;
        button.textContent = label;
      });
  }

  var forms = document.querySelectorAll('form[data-form]');
  for (var i = 0; i < forms.length; i++) forms[i].addEventListener('submit', onSubmit);
})();
