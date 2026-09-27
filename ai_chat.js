/**
 * ai_chat.js — Frontend Controller for Neural Hub V5
 */
const AIChat = {
    logEl: null,
    inputEl: null,
    sendBtn: null,
    teachBtn: null,

    init() {
        this.logEl = document.getElementById('neural-log');
        this.inputEl = document.getElementById('neural-input');
        this.sendBtn = document.getElementById('btn-send-neural');
        this.teachBtn = document.getElementById('btn-teach');

        if (!this.logEl) return;

        this.sendBtn.onclick = () => this.handleSendMessage();
        this.inputEl.onkeypress = (e) => { if (e.key === 'Enter') this.handleSendMessage(); };
        this.teachBtn.onclick = () => this.handleTeachMode();

        console.log('🧠 NEURAL CORE: Online.');
    },

    addMessage(text, type = 'ai') {
        const msg = document.createElement('div');
        msg.className = `neural-msg ${type}`;
        msg.innerText = text;
        this.logEl.appendChild(msg);
        this.logEl.scrollTop = this.logEl.scrollHeight;
    },

    async handleSendMessage() {
        const text = this.inputEl.value.trim();
        if (!text) return;

        this.addMessage(text, 'user');
        this.inputEl.value = '';

        try {
            const hStr = (typeof history !== 'undefined') ? history.slice(-15).join(', ') : '';
            
            const response = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    text: text, 
                    tableId: typeof currentTableId !== 'undefined' ? currentTableId : 1,
                    historyStr: hStr
                })
            });
            const data = await response.json();
            this.addMessage(data.reply, 'ai');
        } catch (e) {
            this.addMessage('Error de conexión con mi núcleo neural.', 'ai');
        }
    },

    async handleTeachMode() {
        this.addMessage('¿Qué patrón acabas de ver? (Ej: "Después de 2R-2L suele venir un gran salto CW")', 'ai');
        this.inputEl.placeholder = 'Describe el patrón experto...';
        this.inputEl.focus();
    },

    // Notified when a spin occurs to update the "sentiment"
    onNewSpin(number, analysis) {
        if (Math.random() > 0.7) { // Only comment occasionally
            setTimeout(() => {
                const comment = this.generateAiComment(number, analysis);
                if (comment) this.addMessage(comment, 'ai');
            }, 1000);
        }
    },

    generateAiComment(number, analysis) {
        const hits = analysis.masterConfidence > 70;
        if (hits) return `Buen movimiento. Mi base de datos confirma que este sector está caliente ahora.`;
        if (analysis.isRhythm) return `Ojo con el ritmo ${analysis.rhythmName}. El dealer está siendo muy predecible.`;
        return null;
    }
};

window.AIChat = AIChat;
