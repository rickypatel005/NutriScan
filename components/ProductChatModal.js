import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { get, ref } from 'firebase/database';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { COLORS, RADIUS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { auth, database } from '../services/firebaseConfig';
import { chatWithGemini } from '../services/geminiService';
import { Body, Heading } from './Typography';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function ProductChatModal({ visible, onClose, productContext }) {
    const { colors, isDark } = useTheme();
    const [message, setMessage] = useState('');
    const [messages, setMessages] = useState([
        { id: 'init', role: 'assistant', text: `Hi! I analyzed ${productContext?.productName || 'this item'}. Ask me anything about its nutrition or health impact!` }
    ]);
    const [loading, setLoading] = useState(false);
    const scrollViewRef = useRef();

    // Animation for modal contents
    const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

    useEffect(() => {
        if (visible) {
            Animated.spring(slideAnim, {
                toValue: 0,
                useNativeDriver: true,
                tension: 50,
                friction: 8
            }).start();
            setMessages([
                { id: 'init', role: 'assistant', text: `Hi! I analyzed ${productContext?.productName || 'this item'}. Ask me anything about its nutrition or health impact!` }
            ]);
        } else {
            Animated.timing(slideAnim, {
                toValue: SCREEN_HEIGHT,
                duration: 300,
                useNativeDriver: true
            }).start();
        }
    }, [visible]);

    const handleSend = async () => {
        if (!message.trim() || loading) return;

        const userMsg = { id: Date.now().toString(), role: 'user', text: message };
        setMessages(prev => [...prev, userMsg]);
        setMessage('');
        setLoading(true);

        try {
            // Get User Profile context
            const user = auth.currentUser;
            let userProfile = { vegType: 'Vegetarian', goal: 'General Health' };
            if (user) {
                const snap = await get(ref(database, `users/${user.uid}/settings`));
                if (snap.exists()) {
                    const s = snap.val();
                    userProfile = {
                        vegType: s.diet ? (Array.isArray(s.diet) ? s.diet.join(', ') : s.diet) : 'Vegetarian',
                        goal: s.goal || 'General Health'
                    };
                }
            }

            // Call Gemini
            const replyText = await chatWithGemini(userMsg.text, productContext, userProfile, messages);

            const botMsg = { id: (Date.now() + 1).toString(), role: 'assistant', text: replyText };
            setMessages(prev => [...prev, botMsg]);

        } catch (error) {
            setMessages(prev => [...prev, { id: Date.now(), role: 'assistant', text: "Sorry, I'm having trouble connecting right now." }]);
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        Animated.timing(slideAnim, {
            toValue: SCREEN_HEIGHT,
            duration: 200,
            useNativeDriver: true
        }).start(() => onClose());
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={handleClose}
        >
            <View style={styles.overlay}>
                <TouchableOpacity style={styles.backdrop} onPress={handleClose} activeOpacity={1} />

                <Animated.View
                    style={[
                        styles.modalContainer,
                        {
                            backgroundColor: isDark ? '#1e1e1e' : '#fff',
                            transform: [{ translateY: slideAnim }]
                        }
                    ]}
                >
                    <View style={styles.header}>
                        <View style={styles.dragHandle} />
                        <View style={styles.headerContent}>
                            <Heading level={3}>Ask Nutritionist AI</Heading>
                            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                                <Ionicons name="close" size={24} color={colors.text.primary} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <ScrollView
                        ref={scrollViewRef}
                        style={styles.chatArea}
                        contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
                        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
                    >
                        {messages.map((msg) => (
                            <View
                                key={msg.id}
                                style={[
                                    styles.messageBubble,
                                    msg.role === 'user'
                                        ? { alignSelf: 'flex-end', backgroundColor: COLORS.primary }
                                        : { alignSelf: 'flex-start', backgroundColor: isDark ? '#333' : '#f0f0f0' }
                                ]}
                            >
                                <Body style={{ color: msg.role === 'user' ? '#fff' : colors.text.primary }}>
                                    {msg.text}
                                </Body>
                            </View>
                        ))}
                        {loading && (
                            <View style={[styles.messageBubble, { alignSelf: 'flex-start', backgroundColor: isDark ? '#333' : '#f0f0f0' }]}>
                                <ActivityIndicator size="small" color={colors.text.muted} />
                            </View>
                        )}
                    </ScrollView>

                    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
                        <BlurView intensity={isDark ? 30 : 80} tint={isDark ? 'dark' : 'light'} style={styles.inputArea}>
                            <TextInput
                                style={[
                                    styles.input,
                                    {
                                        backgroundColor: isDark ? '#333' : '#f5f5f5',
                                        color: colors.text.primary
                                    }
                                ]}
                                placeholder="Ask specifically about this product..."
                                placeholderTextColor={colors.text.muted}
                                value={message}
                                onChangeText={setMessage}
                                returnKeyType="send"
                                onSubmitEditing={handleSend}
                            />
                            <TouchableOpacity
                                onPress={handleSend}
                                disabled={!message.trim() || loading}
                                style={[styles.sendBtn, { backgroundColor: (!message.trim() || loading) ? colors.border : COLORS.primary }]}
                            >
                                <Ionicons name="send" size={20} color="#fff" />
                            </TouchableOpacity>
                        </BlurView>
                    </KeyboardAvoidingView>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    modalContainer: {
        height: '85%',
        borderTopLeftRadius: RADIUS.xl,
        borderTopRightRadius: RADIUS.xl,
        width: '100%',
        overflow: 'hidden',
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
        elevation: 20,
    },
    header: {
        paddingTop: 12,
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(150,150,150,0.1)',
        alignItems: 'center',
    },
    dragHandle: {
        width: 40,
        height: 5,
        borderRadius: 2.5,
        backgroundColor: 'rgba(150,150,150,0.3)',
        marginBottom: 12,
    },
    headerContent: {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    closeBtn: {
        padding: 4,
    },
    chatArea: {
        flex: 1,
    },
    messageBubble: {
        padding: 12,
        borderRadius: 16,
        maxWidth: '80%',
        marginBottom: 8,
    },
    inputArea: {
        flexDirection: 'row',
        padding: 16,
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: 'rgba(150,150,150,0.1)',
    },
    input: {
        flex: 1,
        height: 48,
        borderRadius: 24,
        paddingHorizontal: 16,
        marginRight: 12,
        fontSize: 16,
    },
    sendBtn: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
